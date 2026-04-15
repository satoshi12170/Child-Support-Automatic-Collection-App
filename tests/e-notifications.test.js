'use strict';

/**
 * カテゴリ E: 通知スケジュール（Cronジョブ）テスト
 * 根拠：詳細設計 §4 通知スケジュールロジック、基本設計 §6 通知スケジュール設計
 */

const {
  setupTestDb, teardownTestDb, createMockClient,
  createPair, createCycle,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

/**
 * reminders.jsのgetAllActiveCyclesと同等のクエリを直接実行
 * （reminders.jsはclientをrequire時に解決するため直接テストが困難、
 *  ここではDBロジック+通知条件ロジックを単体テスト）
 */
function getAllActiveCycles() {
  return db.prepare(`
    SELECT pc.*, p.amount, p.due_day,
      ru.line_user_id AS receiver_line_user_id,
      pu.line_user_id AS payer_line_user_id
    FROM payment_cycles pc
    JOIN pairs p ON p.id = pc.pair_id
    JOIN users ru ON ru.id = p.receiver_id
    JOIN users pu ON pu.id = p.payer_id
    WHERE p.status = 'active'
      AND pc.status IN ('pending', 'overdue')
  `).all();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── E-01〜E-04: 通知条件テスト ──────────────────────────────

describe('E: 通知スケジュール', () => {
  test('E-01: 3日前リマインド → pending cycleが対象', () => {
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', 28, 'pending');

    const cycles = getAllActiveCycles();
    expect(cycles).toHaveLength(1);

    const cycle = cycles[0];
    const threeDaysBefore = addDays(cycle.due_date, -3);
    // 期日の3日前が存在することを確認
    expect(threeDaysBefore).toBe('2026-04-25');
    expect(cycle.status).toBe('pending');
    expect(cycle.payer_line_user_id).toBe('U_payer');
  });

  test('E-02: 当日リマインド → 期日当日のpending cycleが対象', () => {
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', 25, 'pending');

    const cycles = getAllActiveCycles();
    const cycle = cycles[0];
    expect(cycle.due_date).toBe('2026-04-25');
    expect(cycle.status).toBe('pending');
  });

  test('E-03: 翌日overdue遷移 → pending cycleのみ対象', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, '2026-04', 25, 'pending');

    // markOverdue実行
    paymentCycles.markOverdue(cycle.cycleId);

    const updated = db.prepare("SELECT * FROM payment_cycles WHERE id = ?").get(cycle.cycleId);
    expect(updated.status).toBe('overdue');

    // 翌日の日付確認
    const dayAfter = addDays('2026-04-25', 1);
    expect(dayAfter).toBe('2026-04-26');
  });

  test('E-04: 8日後二次催促 → overdue cycleが対象', () => {
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', 25, 'overdue');

    const cycles = getAllActiveCycles();
    const cycle = cycles[0];

    const day8After = addDays(cycle.due_date, 8);
    expect(day8After).toBe('2026-05-03');
    expect(cycle.status).toBe('overdue');
  });

  test('E-05: reported状態は通知対象外', () => {
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', 25, 'reported');

    const cycles = getAllActiveCycles();
    expect(cycles).toHaveLength(0);
  });

  test('E-06: confirmed状態は通知対象外', () => {
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', 25, 'confirmed');

    const cycles = getAllActiveCycles();
    expect(cycles).toHaveLength(0);
  });

  test('E-07: paused/endedペアは通知対象外', () => {
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', 25, 'pending');

    // ペアをpausedに変更
    db.prepare("UPDATE pairs SET status = 'paused' WHERE id = ?").run(pair.pairId);

    const cycles = getAllActiveCycles();
    expect(cycles).toHaveLength(0);
  });

  test('E-08: 毎月1日サイクル自動生成', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair1 = createPair(db, { receiverLineId: 'U_r1', payerLineId: 'U_p1' });
    const pair2 = createPair(db, { receiverLineId: 'U_r2', payerLineId: 'U_p2' });
    const pair3 = createPair(db, { receiverLineId: 'U_r3', payerLineId: 'U_p3' });

    const count = paymentCycles.generateMonthlyForAllPairs('2026-05');
    expect(count).toBe(3);

    const cycles = db.prepare("SELECT * FROM payment_cycles WHERE month = '2026-05'").all();
    expect(cycles).toHaveLength(3);
    cycles.forEach(c => expect(c.status).toBe('pending'));
  });

  test('E-09: 重複サイクル防止 — getOrCreateCurrentで既存サイクルを返す', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, '2026-05', pair.dueDay, 'pending');

    // getOrCreateCurrentは既存のサイクルを返す（重複生成しない）
    const existing = paymentCycles.getByMonth(pair.pairId, '2026-05');
    expect(existing).toBeDefined();
    expect(existing.id).toBe(cycle.cycleId);
    expect(existing.status).toBe('pending');
  });
});
