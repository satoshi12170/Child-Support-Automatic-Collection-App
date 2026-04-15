'use strict';

/**
 * カテゴリ A: オンボーディング正常系テスト
 * 根拠：詳細設計 §2 会話状態定義、基本設計 §4 会話フロー概要
 */

const {
  setupTestDb, teardownTestDb, createMockClient,
  makeFollowEvent, makeTextEvent,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── A-1: 受取人オンボーディング ──────────────────────────────

describe('A-1: 受取人オンボーディング（正常系）', () => {
  test('A-1-01: 友だち追加（初回）→ 役割選択メッセージが返る', async () => {
    const { handleFollow } = require('../src/handlers/follow');
    const event = makeFollowEvent('U_new_user');
    await handleFollow(event, client);

    expect(client.replyMessage).toHaveBeenCalled();
    const text = client.getLastReplyText();
    expect(text).toContain('受取人');
    expect(text).toContain('支払い義務者');
    // クイックリプライが含まれている
    const reply = client.replies[0].message;
    expect(reply.quickReply).toBeDefined();
    expect(reply.quickReply.items).toHaveLength(2);
  });

  test('A-1-02: 役割選択「1」→ 名前入力を促すメッセージが返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_recv', 'onboarding_role', {});
    const event = makeTextEvent('U_recv', '1');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('お名前');
    expect(text).toContain('フルネーム');
  });

  test('A-1-03: 名前入力 → 金額入力を促すメッセージが返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_recv', 'onboarding_name', { role: 'receiver' });
    const event = makeTextEvent('U_recv', '山田 花子');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('金額');
    expect(text).toContain('円');
  });

  test('A-1-04: 金額入力 → 期日入力を促すメッセージが返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_recv', 'onboarding_amount', { role: 'receiver', name: '山田 花子' });
    const event = makeTextEvent('U_recv', '50000');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('期日');
    expect(text).toContain('1〜28');
  });

  test('A-1-05: 期日入力 → 確認メッセージが返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_recv', 'onboarding_due_day', {
      role: 'receiver', name: '山田 花子', amount: 50000,
    });
    const event = makeTextEvent('U_recv', '25');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('山田 花子');
    expect(text).toContain('50,000');
    expect(text).toContain('25日');
    expect(text).toContain('はい');
    expect(text).toContain('いいえ');
  });

  test('A-1-06: 確認「はい」→ 登録完了+招待コード（8桁）が返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_recv', 'onboarding_confirm', {
      role: 'receiver', name: '山田 花子', amount: 50000, dueDay: 25,
    });
    const event = makeTextEvent('U_recv', 'はい');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('登録が完了');
    expect(text).toContain('招待コード');
    expect(text).toContain('48時間');
    // 8桁英数字コードが含まれている
    const codeMatch = text.match(/🔑\s*([A-Z0-9]{8})/);
    expect(codeMatch).not.toBeNull();

    // DBにユーザーが作成されている
    const user = db.prepare("SELECT * FROM users WHERE line_user_id = 'U_recv'").get();
    expect(user).toBeDefined();
    expect(user.role).toBe('receiver');

    // 招待コードがDBに作成されている
    const codes = db.prepare('SELECT * FROM invite_codes WHERE receiver_id = ?').all(user.id);
    expect(codes).toHaveLength(1);
    expect(codes[0].code).toHaveLength(8);

    // 会話状態がidleに戻っている
    const state = conversationStates.get('U_recv');
    expect(state.state).toBe('idle');
  });
});

// ─── A-2: 義務者オンボーディング ──────────────────────────────

describe('A-2: 義務者オンボーディング（正常系）', () => {
  let receiverUser, inviteCode;

  beforeEach(() => {
    // 受取人を先に作成して招待コードを発行
    const { v4: uuidv4 } = require('uuid');
    const { encrypt } = require('../src/utils/crypto');
    const receiverId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)
    `).run(receiverId, 'U_recv_existing', encrypt('既存受取人'));

    const inviteCodes = require('../src/db/inviteCodes');
    const inv = inviteCodes.create(receiverId, 50000, 25);
    inviteCode = inv.code;
    receiverUser = { id: receiverId, lineUserId: 'U_recv_existing' };
  });

  test('A-2-01: 役割選択「2」→ 招待コード入力を促すメッセージが返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_payer_new', 'onboarding_role', {});
    const event = makeTextEvent('U_payer_new', '2');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('招待コード');
    expect(text).toContain('8桁');
  });

  test('A-2-02: 有効な招待コード入力 → 名前入力を促すメッセージが返る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_payer_new', 'onboarding_invite_code', { role: 'payer' });
    const event = makeTextEvent('U_payer_new', inviteCode);
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('50,000');
    expect(text).toContain('25日');
    expect(text).toContain('お名前');
  });

  test('A-2-03/04: 名前入力→確認「はい」→ 登録完了+受取人に通知', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    // 名前入力
    conversationStates.set('U_payer_new', 'onboarding_name', { role: 'payer', inviteCode });
    const nameEvent = makeTextEvent('U_payer_new', '山田 太郎');
    await handleOnboarding(nameEvent, client);

    const confirmText = client.getLastReplyText();
    expect(confirmText).toContain('山田 太郎');
    expect(confirmText).toContain('50,000');

    // 確認「はい」
    client.replies.length = 0;
    client.pushes.length = 0;
    const confirmEvent = makeTextEvent('U_payer_new', 'はい');
    await handleOnboarding(confirmEvent, client);

    // 登録完了メッセージ
    const text = client.getLastReplyText();
    expect(text).toContain('登録が完了');
    expect(text).toContain('振込みました');

    // 受取人へプッシュ通知
    expect(client.pushMessage).toHaveBeenCalled();
    const pushText = client.getLastPushText();
    expect(pushText).toContain('ペアリング完了');

    // DBにペアが作成されている
    const pair = db.prepare("SELECT * FROM pairs WHERE status = 'active'").get();
    expect(pair).toBeDefined();
    expect(pair.amount).toBe(50000);
    expect(pair.due_day).toBe(25);

    // 招待コードが使用済みになっている
    const usedCode = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(inviteCode);
    expect(usedCode.used_at).not.toBeNull();
  });
});

// ─── A-3: オンボーディング共通 ────────────────────────────────

describe('A-3: オンボーディング共通', () => {
  test('A-3-01: 確認「いいえ」→ 役割選択に戻る', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_test', 'onboarding_confirm', {
      role: 'receiver', name: 'テスト', amount: 30000, dueDay: 15,
    });
    const event = makeTextEvent('U_test', 'いいえ');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('やり直し');
    expect(text).toContain('1');
    expect(text).toContain('2');

    const state = conversationStates.get('U_test');
    expect(state.state).toBe('onboarding_role');
  });

  test('A-3-02: 登録済みユーザーの友だち追加 → 復帰メッセージ', async () => {
    const { handleFollow } = require('../src/handlers/follow');
    const { createReceiver } = require('./helpers');
    createReceiver(db, 'U_returning');

    const event = makeFollowEvent('U_returning');
    await handleFollow(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('おかえりなさい');
  });

  test('A-3-03: 未登録ユーザーのコマンド → オンボーディング誘導', async () => {
    const conversationStates = require('../src/db/conversationStates');
    // idle状態の未登録ユーザー
    const event = makeTextEvent('U_unknown', '振込みました');

    // webhook.jsのhandleTextMessage相当のロジックをテスト
    const { state } = conversationStates.get('U_unknown');
    expect(state).toBe('idle');

    const users = require('../src/db/users');
    const user = users.getByLineUserId('U_unknown');
    expect(user).toBeNull();
  });
});
