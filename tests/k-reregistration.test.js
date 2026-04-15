'use strict';

/**
 * カテゴリ K: ブロック→再追加後の再登録
 * 根拠：受取人・義務者がアプリをブロックした後、再度友だち追加した場合に
 *       再登録できること（履歴は soft-delete で保全）
 */

const {
  setupTestDb, teardownTestDb, createMockClient,
  makeFollowEvent, makeUnfollowEvent, makeTextEvent,
  createPair,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── K-1: unfollow イベントによるクリーンアップ ──────────────────

describe('K-1: unfollow イベント処理', () => {
  test('K-1-01: 受取人がブロック → deactivated_at 設定 / pair ended / 招待コード無効化', async () => {
    const { handleUnfollow } = require('../src/handlers/follow');
    const inviteCodes = require('../src/db/inviteCodes');
    const { receiver, pairId } = createPair(db, {
      receiverLineId: 'U_recv_block',
      payerLineId: 'U_payer_stay',
    });
    // 受取人が追加の招待コードを発行済み（未使用）
    inviteCodes.create(receiver.id, 50000, 25);

    await handleUnfollow(makeUnfollowEvent('U_recv_block'), client);

    // ユーザーは deactivated_at が設定されている
    const userRow = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get('U_recv_block');
    expect(userRow.deactivated_at).not.toBeNull();

    // pair が ended になっている
    const pairRow = db.prepare('SELECT * FROM pairs WHERE id = ?').get(pairId);
    expect(pairRow.status).toBe('ended');

    // 発行済み招待コードが全て無効化されている
    const activeCodes = db.prepare(
      'SELECT * FROM invite_codes WHERE receiver_id = ? AND used_at IS NULL'
    ).all(receiver.id);
    expect(activeCodes).toHaveLength(0);
  });

  test('K-1-02: 義務者がブロック → deactivated_at 設定 / pair ended', async () => {
    const { handleUnfollow } = require('../src/handlers/follow');
    const { payer, pairId } = createPair(db, {
      receiverLineId: 'U_recv_stay',
      payerLineId: 'U_payer_block',
    });

    await handleUnfollow(makeUnfollowEvent('U_payer_block'), client);

    const userRow = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get('U_payer_block');
    expect(userRow.deactivated_at).not.toBeNull();
    expect(userRow.role).toBe('payer'); // role は変えない（履歴として残す）
    expect(userRow.id).toBe(payer.id);

    const pairRow = db.prepare('SELECT * FROM pairs WHERE id = ?').get(pairId);
    expect(pairRow.status).toBe('ended');
  });

  test('K-1-03: 未登録ユーザーのブロック → エラーなく完了', async () => {
    const { handleUnfollow } = require('../src/handlers/follow');
    // users テーブルに存在しない LINE ID を unfollow しても例外にならない
    await expect(
      handleUnfollow(makeUnfollowEvent('U_unknown_block'), client)
    ).resolves.not.toThrow();

    // 会話状態は idle に落ちている
    const conversationStates = require('../src/db/conversationStates');
    expect(conversationStates.get('U_unknown_block').state).toBe('idle');
  });

  test('K-1-04: unfollow でオンボーディング中の会話状態もリセット', async () => {
    const { handleUnfollow } = require('../src/handlers/follow');
    const conversationStates = require('../src/db/conversationStates');
    // オンボーディング途中の状態を作る
    conversationStates.set('U_mid_onb', 'onboarding_amount', { role: 'receiver', name: 'テスト' });

    await handleUnfollow(makeUnfollowEvent('U_mid_onb'), client);

    expect(conversationStates.get('U_mid_onb').state).toBe('idle');
  });
});

// ─── K-2: 再 follow → 再登録フロー ──────────────────────────────

describe('K-2: 再 follow → 再登録', () => {
  test('K-2-01: 受取人がブロック→再追加 → 役割選択メッセージが返る（おかえりなさいではない）', async () => {
    const { handleFollow, handleUnfollow } = require('../src/handlers/follow');
    createPair(db, { receiverLineId: 'U_recv_rereg', payerLineId: 'U_payer_x' });

    // ブロック
    await handleUnfollow(makeUnfollowEvent('U_recv_rereg'), client);

    // 再追加
    client.replies.length = 0;
    await handleFollow(makeFollowEvent('U_recv_rereg'), client);

    const text = client.getLastReplyText();
    expect(text).not.toContain('おかえりなさい');
    expect(text).toContain('受取人');
    expect(text).toContain('支払い義務者');

    // 会話状態が onboarding_role になっている
    const conversationStates = require('../src/db/conversationStates');
    expect(conversationStates.get('U_recv_rereg').state).toBe('onboarding_role');
  });

  test('K-2-02: 義務者がブロック→再追加 → 役割選択メッセージが返る', async () => {
    const { handleFollow, handleUnfollow } = require('../src/handlers/follow');
    createPair(db, { receiverLineId: 'U_recv_y', payerLineId: 'U_payer_rereg' });

    await handleUnfollow(makeUnfollowEvent('U_payer_rereg'), client);
    client.replies.length = 0;
    await handleFollow(makeFollowEvent('U_payer_rereg'), client);

    const text = client.getLastReplyText();
    expect(text).not.toContain('おかえりなさい');
    expect(text).toContain('受取人');
    expect(text).toContain('支払い義務者');
  });

  test('K-2-03: 再登録完了後、users.id は再利用され履歴が保全される', async () => {
    const { handleFollow, handleUnfollow } = require('../src/handlers/follow');
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { receiver: originalReceiver } = createPair(db, {
      receiverLineId: 'U_recv_reuse',
      payerLineId: 'U_payer_gone',
    });
    const originalId = originalReceiver.id;

    // ブロック→再追加
    await handleUnfollow(makeUnfollowEvent('U_recv_reuse'), client);
    await handleFollow(makeFollowEvent('U_recv_reuse'), client);

    // 受取人として再オンボーディング
    conversationStates.set('U_recv_reuse', 'onboarding_role', {});
    await handleOnboarding(makeTextEvent('U_recv_reuse', '1'), client);
    await handleOnboarding(makeTextEvent('U_recv_reuse', '新名義 花子'), client);
    await handleOnboarding(makeTextEvent('U_recv_reuse', '60000'), client);
    await handleOnboarding(makeTextEvent('U_recv_reuse', '15'), client);
    await handleOnboarding(makeTextEvent('U_recv_reuse', 'はい'), client);

    // 同じ users.id が再利用されている
    const userRow = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get('U_recv_reuse');
    expect(userRow.id).toBe(originalId);
    expect(userRow.deactivated_at).toBeNull();
    expect(userRow.role).toBe('receiver');

    // 過去の ended pair は履歴として残っている
    const endedPairs = db.prepare(
      "SELECT * FROM pairs WHERE receiver_id = ? AND status = 'ended'"
    ).all(originalId);
    expect(endedPairs.length).toBeGreaterThanOrEqual(1);

    // 新しい招待コードが発行されている
    const newCode = db.prepare(
      'SELECT * FROM invite_codes WHERE receiver_id = ? AND used_at IS NULL'
    ).get(originalId);
    expect(newCode).toBeDefined();
    expect(newCode.amount).toBe(60000);
    expect(newCode.due_day).toBe(15);
  });

  test('K-2-04: 義務者がブロック→再追加 → 新しい招待コードで別の受取人とペアリング可能', async () => {
    const { handleFollow, handleUnfollow } = require('../src/handlers/follow');
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { encrypt } = require('../src/utils/crypto');
    const { v4: uuidv4 } = require('uuid');
    const inviteCodes = require('../src/db/inviteCodes');

    // 旧ペア作成
    const { payer: originalPayer } = createPair(db, {
      receiverLineId: 'U_recv_old',
      payerLineId: 'U_payer_x2',
    });
    const originalPayerId = originalPayer.id;

    // 新しい受取人と新しい招待コードを用意
    const newReceiverId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)
    `).run(newReceiverId, 'U_recv_new', encrypt('新受取人'));
    const newInv = inviteCodes.create(newReceiverId, 30000, 10);

    // 義務者がブロック→再追加
    await handleUnfollow(makeUnfollowEvent('U_payer_x2'), client);
    await handleFollow(makeFollowEvent('U_payer_x2'), client);

    // 新しい招待コードで再登録
    conversationStates.set('U_payer_x2', 'onboarding_role', {});
    await handleOnboarding(makeTextEvent('U_payer_x2', '2'), client);
    await handleOnboarding(makeTextEvent('U_payer_x2', newInv.code), client);
    await handleOnboarding(makeTextEvent('U_payer_x2', '新義務者 太郎'), client);
    await handleOnboarding(makeTextEvent('U_payer_x2', 'はい'), client);

    // 同じ users.id が再利用されている
    const userRow = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get('U_payer_x2');
    expect(userRow.id).toBe(originalPayerId);
    expect(userRow.deactivated_at).toBeNull();

    // 新しいアクティブ pair ができている
    const activePair = db.prepare(`
      SELECT * FROM pairs WHERE payer_id = ? AND status = 'active'
    `).get(originalPayerId);
    expect(activePair).toBeDefined();
    expect(activePair.receiver_id).toBe(newReceiverId);
    expect(activePair.amount).toBe(30000);
  });

  test('K-2-05: ペア確立済みユーザーの再 follow → ペア解消して再登録フロー', async () => {
    // 仕様：follow イベントはブロック解除後の再追加でしか発生しない。
    // したがってペアリング完了状態でも、再追加時は一律で再登録させる。
    const { handleFollow } = require('../src/handlers/follow');
    const { pairId } = createPair(db, {
      receiverLineId: 'U_still_active',
      payerLineId: 'U_still_active_partner',
    });

    await handleFollow(makeFollowEvent('U_still_active'), client);

    const text = client.getLastReplyText();
    expect(text).not.toContain('おかえりなさい');
    expect(text).toContain('受取人');
    expect(text).toContain('支払い義務者');

    // 旧ペアは ended に、自分は deactivated になっている
    const pairRow = db.prepare('SELECT * FROM pairs WHERE id = ?').get(pairId);
    expect(pairRow.status).toBe('ended');
    const userRow = db.prepare(
      'SELECT * FROM users WHERE line_user_id = ?'
    ).get('U_still_active');
    expect(userRow.deactivated_at).not.toBeNull();

    // 会話状態は onboarding_role
    const conversationStates = require('../src/db/conversationStates');
    expect(conversationStates.get('U_still_active').state).toBe('onboarding_role');
  });

  test('K-2-06: ペアリング未完了で再 follow → unfollow未配信でも再登録フローに入る', async () => {
    // 実機再現シナリオ：受取人が招待コードを発行したがペアリング前にブロック、
    // LINE から unfollow イベントが届かず users.deactivated_at が NULL のまま
    // 再 follow が来た場合でも、強制的にリセットして役割選択に進めること。
    const { handleFollow } = require('../src/handlers/follow');
    const { createReceiver } = require('./helpers');
    const inviteCodes = require('../src/db/inviteCodes');
    const receiver = createReceiver(db, 'U_orphan_recv');
    inviteCodes.create(receiver.id, 50000, 25);

    await handleFollow(makeFollowEvent('U_orphan_recv'), client);

    const text = client.getLastReplyText();
    expect(text).not.toContain('おかえりなさい');
    expect(text).toContain('受取人');
    expect(text).toContain('支払い義務者');

    // 孤立した招待コードは使用済みに回収されている
    const orphanCodes = db.prepare(
      'SELECT * FROM invite_codes WHERE receiver_id = ? AND used_at IS NULL'
    ).all(receiver.id);
    expect(orphanCodes).toHaveLength(0);

    // 会話状態が onboarding_role になっている
    const conversationStates = require('../src/db/conversationStates');
    expect(conversationStates.get('U_orphan_recv').state).toBe('onboarding_role');
  });

  test('K-2-07: ペアリング未完了の受取人がテキスト送信 → 再登録誘導', async () => {
    // 実機再現シナリオ：unfollow未配信で users は active のまま、
    // ユーザーが「振込みました」等を送ったケース。従来は NoCycleError で行き詰まっていた。
    process.env.LINE_CHANNEL_SECRET = 'test-secret';
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const { createReceiver } = require('./helpers');
    createReceiver(db, 'U_orphan_text');

    const { handleTextMessage } = require('../src/routes/webhook');
    await handleTextMessage(makeTextEvent('U_orphan_text', '振込みました'), client);

    const text = client.getLastReplyText();
    // 孤立ユーザーも follow イベントと同じ WELCOME_MESSAGE を返す仕様
    expect(text).toContain('ようこそ');
    expect(text).toContain('受取人');

    // 会話状態が onboarding_role にセットされている
    const conversationStates = require('../src/db/conversationStates');
    expect(conversationStates.get('U_orphan_text').state).toBe('onboarding_role');
  });
});

// ─── K-3: soft-delete 後の参照ルール ─────────────────────────

describe('K-3: deactivated ユーザーの参照', () => {
  test('K-3-01: users.getByLineUserId は deactivated ユーザーを返さない', () => {
    const { handleUnfollow } = require('../src/handlers/follow');
    const users = require('../src/db/users');
    createPair(db, { receiverLineId: 'U_gb', payerLineId: 'U_gb2' });

    // ブロック前はアクティブとして取得可
    expect(users.getByLineUserId('U_gb')).not.toBeNull();

    return handleUnfollow(makeUnfollowEvent('U_gb'), client).then(() => {
      // ブロック後は null
      expect(users.getByLineUserId('U_gb')).toBeNull();
      // ただし findAnyByLineUserId では引ける
      const any = users.findAnyByLineUserId('U_gb');
      expect(any).not.toBeNull();
      expect(any.deactivated_at).not.toBeNull();
    });
  });

  test('K-3-02: deactivated ユーザーがテキスト送信 → 未登録扱いでオンボーディング誘導', async () => {
    const { handleUnfollow } = require('../src/handlers/follow');
    const users = require('../src/db/users');
    createPair(db, { receiverLineId: 'U_block_then_type', payerLineId: 'U_other' });
    await handleUnfollow(makeUnfollowEvent('U_block_then_type'), client);

    // 未登録扱い
    expect(users.getByLineUserId('U_block_then_type')).toBeNull();
  });
});
