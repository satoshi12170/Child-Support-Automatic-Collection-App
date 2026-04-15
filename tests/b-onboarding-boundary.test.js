'use strict';

/**
 * カテゴリ B: オンボーディング異常系・境界値テスト
 * 根拠：詳細設計 §1 DB定義（制約）、§5 エラーハンドリング
 */

const {
  setupTestDb, teardownTestDb, createMockClient, makeTextEvent,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── B-1: 名前入力バリデーション ──────────────────────────────

describe('B-1: 名前入力バリデーション', () => {
  function setupNameState(lineUserId) {
    const conversationStates = require('../src/db/conversationStates');
    conversationStates.set(lineUserId, 'onboarding_name', { role: 'receiver' });
  }

  test('B-1-01: 空文字 → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupNameState('U_test');
    const event = makeTextEvent('U_test', ' ');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1〜50文字');
  });

  test('B-1-02: 1文字（下限値） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupNameState('U_test');
    const event = makeTextEvent('U_test', 'あ');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('金額');
  });

  test('B-1-03: 50文字（上限値） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupNameState('U_test');
    const event = makeTextEvent('U_test', 'あ'.repeat(50));
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('金額');
  });

  test('B-1-04: 51文字（上限超過） → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupNameState('U_test');
    const event = makeTextEvent('U_test', 'あ'.repeat(51));
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1〜50文字');
  });
});

// ─── B-2: 金額入力バリデーション ──────────────────────────────

describe('B-2: 金額入力バリデーション', () => {
  function setupAmountState(lineUserId) {
    const conversationStates = require('../src/db/conversationStates');
    conversationStates.set(lineUserId, 'onboarding_amount', {
      role: 'receiver', name: 'テスト',
    });
  }

  test('B-2-01: 下限値未満（999） → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '999');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1,000円〜10,000,000円');
  });

  test('B-2-02: 下限値（1000） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '1000');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('期日');
  });

  test('B-2-03: 上限値（10000000） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '10000000');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('期日');
  });

  test('B-2-04: 上限値超過（10000001） → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '10000001');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1,000円〜10,000,000円');
  });

  test('B-2-05: カンマ区切り（50,000） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '50,000');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('期日');
  });

  test('B-2-06: 非数値 → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '五万円');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1,000円〜10,000,000円');
  });

  test('B-2-08: 負の値 → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '-50000');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1,000円〜10,000,000円');
  });

  test('B-2-09: ゼロ → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupAmountState('U_test');
    const event = makeTextEvent('U_test', '0');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1,000円〜10,000,000円');
  });
});

// ─── B-3: 期日入力バリデーション ──────────────────────────────

describe('B-3: 期日入力バリデーション', () => {
  function setupDueDayState(lineUserId) {
    const conversationStates = require('../src/db/conversationStates');
    conversationStates.set(lineUserId, 'onboarding_due_day', {
      role: 'receiver', name: 'テスト', amount: 50000,
    });
  }

  test('B-3-01: 下限値未満（0） → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupDueDayState('U_test');
    const event = makeTextEvent('U_test', '0');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1〜28');
  });

  test('B-3-02: 下限値（1） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupDueDayState('U_test');
    const event = makeTextEvent('U_test', '1');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('登録します');
  });

  test('B-3-03: 上限値（28） → 正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupDueDayState('U_test');
    const event = makeTextEvent('U_test', '28');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('登録します');
  });

  test('B-3-04: 上限値超過（29） → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupDueDayState('U_test');
    const event = makeTextEvent('U_test', '29');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1〜28');
  });

  test('B-3-05: 非数値 → エラーメッセージ', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    setupDueDayState('U_test');
    const event = makeTextEvent('U_test', '月末');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('1〜28');
  });
});

// ─── B-4: 招待コードバリデーション ────────────────────────────

describe('B-4: 招待コードバリデーション', () => {
  test('B-4-01: 存在しないコード → エラー', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { InvalidInviteCodeError } = require('../src/utils/errors');

    conversationStates.set('U_test', 'onboarding_invite_code', { role: 'payer' });
    const event = makeTextEvent('U_test', 'XXXXXXXX');

    await expect(handleOnboarding(event, client)).rejects.toThrow(InvalidInviteCodeError);
  });

  test('B-4-02: 期限切れコード → エラー', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { InvalidInviteCodeError } = require('../src/utils/errors');
    const { v4: uuidv4 } = require('uuid');
    const { encrypt } = require('../src/utils/crypto');

    // 受取人を作成
    const receiverId = uuidv4();
    db.prepare("INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)")
      .run(receiverId, 'U_recv_expired', encrypt('テスト'));

    // 期限切れの招待コード作成（SQLite datetime形式で明確に過去日時を設定）
    const codeId = uuidv4();
    const expiredAt = '2025-01-01 00:00:00';
    db.prepare("INSERT INTO invite_codes (id, code, receiver_id, amount, due_day, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(codeId, 'EXPIRED1', receiverId, 50000, 25, expiredAt);

    conversationStates.set('U_test', 'onboarding_invite_code', { role: 'payer' });
    const event = makeTextEvent('U_test', 'EXPIRED1');

    await expect(handleOnboarding(event, client)).rejects.toThrow(InvalidInviteCodeError);
  });

  test('B-4-03: 使用済みコード → エラー', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { InvalidInviteCodeError } = require('../src/utils/errors');
    const { v4: uuidv4 } = require('uuid');
    const { encrypt } = require('../src/utils/crypto');

    const receiverId = uuidv4();
    db.prepare("INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)")
      .run(receiverId, 'U_recv_used', encrypt('テスト'));

    const codeId = uuidv4();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const usedAt = new Date().toISOString();
    db.prepare("INSERT INTO invite_codes (id, code, receiver_id, amount, due_day, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(codeId, 'USEDCODE', receiverId, 50000, 25, expiresAt, usedAt);

    conversationStates.set('U_test', 'onboarding_invite_code', { role: 'payer' });
    const event = makeTextEvent('U_test', 'USEDCODE');

    await expect(handleOnboarding(event, client)).rejects.toThrow(InvalidInviteCodeError);
  });

  test('B-4-04: 小文字入力 → 大文字変換で正常受理', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { v4: uuidv4 } = require('uuid');
    const { encrypt } = require('../src/utils/crypto');

    const receiverId = uuidv4();
    db.prepare("INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)")
      .run(receiverId, 'U_recv_lower', encrypt('テスト'));

    const inviteCodes = require('../src/db/inviteCodes');
    const inv = inviteCodes.create(receiverId, 40000, 15);

    conversationStates.set('U_test', 'onboarding_invite_code', { role: 'payer' });
    const event = makeTextEvent('U_test', inv.code.toLowerCase());
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('40,000');
  });
});

// ─── B-5: 役割選択バリデーション ──────────────────────────────

describe('B-5: 役割選択バリデーション', () => {
  test('B-5-01: 不正な値「3」→ 再入力促進', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_test', 'onboarding_role', {});
    const event = makeTextEvent('U_test', '3');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('「1」または「2」');
  });

  test('B-5-02: テキスト入力「受取人」→ 再入力促進', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    conversationStates.set('U_test', 'onboarding_role', {});
    const event = makeTextEvent('U_test', '受取人');
    await handleOnboarding(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('「1」または「2」');
  });
});
