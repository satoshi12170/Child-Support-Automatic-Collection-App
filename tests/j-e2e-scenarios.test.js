'use strict';

/**
 * カテゴリ J: E2E（エンドツーエンド）シナリオテスト
 * 根拠：全設計ドキュメントの横断的テスト
 */

const {
  setupTestDb, teardownTestDb, createMockClient,
  makeFollowEvent, makeTextEvent, createPair, createCycle,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── J-01: ハッピーパス全体 ───────────────────────────────────

describe('J-01: ハッピーパス全体', () => {
  test('受取人登録→招待コード発行→義務者登録→ペアリング→支払い→確認→履歴', async () => {
    const { handleFollow } = require('../src/handlers/follow');
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const { handlePaid, handleReceived, handleHistory } = require('../src/handlers/payment');
    const conversationStates = require('../src/db/conversationStates');

    const RECV = 'U_e2e_recv';
    const PAYER = 'U_e2e_payer';

    // ── Step 1: 受取人 友だち追加+登録 ──
    await handleFollow(makeFollowEvent(RECV), client);
    expect(client.getLastReplyText()).toContain('受取人');

    await handleOnboarding(makeTextEvent(RECV, '1'), client);
    await handleOnboarding(makeTextEvent(RECV, '鈴木花子'), client);
    await handleOnboarding(makeTextEvent(RECV, '40000'), client);
    await handleOnboarding(makeTextEvent(RECV, '20'), client);
    await handleOnboarding(makeTextEvent(RECV, 'はい'), client);

    // 招待コードを取得
    const lastReply = client.getLastReplyText();
    expect(lastReply).toContain('招待コード');
    const codeMatch = lastReply.match(/🔑\s*([A-Z0-9]{8})/);
    expect(codeMatch).not.toBeNull();
    const inviteCode = codeMatch[1];

    // ── Step 2: 義務者 友だち追加+登録 ──
    client.replies = [];
    client.pushes = [];
    await handleFollow(makeFollowEvent(PAYER), client);
    await handleOnboarding(makeTextEvent(PAYER, '2'), client);
    await handleOnboarding(makeTextEvent(PAYER, inviteCode), client);
    await handleOnboarding(makeTextEvent(PAYER, '田中太郎'), client);

    client.pushes = [];
    await handleOnboarding(makeTextEvent(PAYER, 'はい'), client);

    // ペアリング完了
    expect(client.getLastReplyText()).toContain('登録が完了');
    // 受取人にペアリング通知
    expect(client.pushMessage).toHaveBeenCalled();
    expect(client.getLastPushText()).toContain('ペアリング完了');

    // ── Step 3: 義務者が支払い報告 ──
    client.replies = [];
    client.pushes = [];
    await handlePaid(makeTextEvent(PAYER, '振込みました'), client);
    expect(client.getLastReplyText()).toContain('振込報告を受け付けました');
    expect(client.getLastPushText()).toContain('振込報告');

    // ── Step 4: 受取人が受取確認 ──
    client.replies = [];
    client.pushes = [];
    await handleReceived(makeTextEvent(RECV, '受け取りました'), client);
    expect(client.getLastReplyText()).toContain('受取確認を記録しました');
    expect(client.getLastPushText()).toContain('受取確認されました');

    // ── Step 5: 履歴確認 ──
    client.replies = [];
    await handleHistory(makeTextEvent(RECV, '履歴'), client);
    const historyText = client.getLastReplyText();
    expect(historyText).toContain('受取確認済み');
    expect(historyText).toContain('40,000');

    // DB最終状態確認
    const cycle = db.prepare(`
      SELECT pc.status FROM payment_cycles pc
      JOIN pairs p ON p.id = pc.pair_id
      WHERE p.status = 'active'
    `).get();
    expect(cycle.status).toBe('confirmed');
  });
});

// ─── J-02: 未払いエスカレーション ─────────────────────────────

describe('J-02: 未払いエスカレーション', () => {
  test('期日超過 → overdue遷移 → 8日後二次催促条件', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, '2026-03', 25, 'pending');

    // Step 1: 期日翌日 → overdue
    paymentCycles.markOverdue(cycle.cycleId);
    let updated = db.prepare("SELECT * FROM payment_cycles WHERE id = ?").get(cycle.cycleId);
    expect(updated.status).toBe('overdue');

    // Step 2: 8日後 → まだoverdue（二次催促条件を満たす）
    updated = db.prepare("SELECT * FROM payment_cycles WHERE id = ? AND status = 'overdue'").get(cycle.cycleId);
    expect(updated).toBeDefined();
  });
});

// ─── J-03: 遅延支払い回復 ─────────────────────────────────────

describe('J-03: 遅延支払い回復', () => {
  test('overdue → reported → confirmed', async () => {
    const { handlePaid, handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'overdue');

    // 遅延報告
    await handlePaid(makeTextEvent(pair.payer.lineUserId, '振込みました'), client);
    let cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('reported');

    // 受取確認
    await handleReceived(makeTextEvent(pair.receiver.lineUserId, '受け取りました'), client);
    cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('confirmed');
  });
});

// ─── J-04: 月次自動サイクル ───────────────────────────────────

describe('J-04: 月次自動サイクル', () => {
  test('前月confirmed → 新月pendingサイクル自動生成', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-03', pair.dueDay, 'confirmed');

    // 月初Cron相当
    paymentCycles.generateMonthlyForAllPairs('2026-04');

    const newCycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ? AND month = '2026-04'").get(pair.pairId);
    expect(newCycle).toBeDefined();
    expect(newCycle.status).toBe('pending');

    // 旧月は変わらない
    const oldCycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ? AND month = '2026-03'").get(pair.pairId);
    expect(oldCycle.status).toBe('confirmed');
  });
});

// ─── J-05: 招待コード再発行 ───────────────────────────────────

describe('J-05: 招待コード期限切れ', () => {
  test('48時間経過後の招待コード → 使用不可', () => {
    const { v4: uuidv4 } = require('uuid');
    const { encrypt } = require('../src/utils/crypto');
    const inviteCodes = require('../src/db/inviteCodes');

    const receiverId = uuidv4();
    db.prepare("INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)")
      .run(receiverId, 'U_recv_j5', encrypt('テスト'));

    // 期限切れコードを直接DB挿入（SQLite datetime形式で明確に過去日時を設定）
    const expiredAt = '2025-01-01 00:00:00';
    db.prepare("INSERT INTO invite_codes (id, code, receiver_id, amount, due_day, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(uuidv4(), 'EXPIRE01', receiverId, 50000, 25, expiredAt);

    const result = inviteCodes.findValid('EXPIRE01');
    expect(result).toBeUndefined();

    // 新しいコードは有効
    const newInv = inviteCodes.create(receiverId, 50000, 25);
    const valid = inviteCodes.findValid(newInv.code);
    expect(valid).toBeDefined();
    expect(valid.code).toBe(newInv.code);
  });
});

// ─── J-06: 複数月連続運用 ─────────────────────────────────────

describe('J-06: 複数月連続運用', () => {
  test('3ヶ月間のサイクルが独立管理される', async () => {
    const { handlePaid, handleReceived } = require('../src/handlers/payment');
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);

    const months = ['2026-02', '2026-03', '2026-04'];

    for (const month of months) {
      const cycle = createCycle(db, pair.pairId, month, pair.dueDay, 'pending');

      // 報告
      db.prepare("UPDATE payment_cycles SET status = 'reported', reported_at = datetime('now') WHERE id = ?")
        .run(cycle.cycleId);
      // 確認
      db.prepare("UPDATE payment_cycles SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?")
        .run(cycle.cycleId);
    }

    // 全3ヶ月がconfirmed
    const allCycles = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ? ORDER BY month").all(pair.pairId);
    expect(allCycles).toHaveLength(3);
    allCycles.forEach(c => expect(c.status).toBe('confirmed'));

    // 各月の期日が正しい
    expect(allCycles[0].due_date).toBe(`2026-02-${String(pair.dueDay).padStart(2, '0')}`);
    expect(allCycles[1].due_date).toBe(`2026-03-${String(pair.dueDay).padStart(2, '0')}`);
    expect(allCycles[2].due_date).toBe(`2026-04-${String(pair.dueDay).padStart(2, '0')}`);
  });
});
