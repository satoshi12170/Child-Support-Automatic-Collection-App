'use strict';

/**
 * カテゴリ D: 状態遷移テスト
 * 根拠：基本設計 §5 支払い状態管理（状態遷移図）
 */

const {
  setupTestDb, teardownTestDb, createMockClient,
  makeTextEvent, createPair, createCycle,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── D-1: PaymentCycle 状態遷移 ──────────────────────────────

describe('D-1: PaymentCycle 状態遷移', () => {
  test('D-1-01: pending → reported → confirmed（正常フロー）', async () => {
    const { handlePaid, handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'pending');

    // 1. 義務者が報告
    const paidEvent = makeTextEvent(pair.payer.lineUserId, '振込みました');
    await handlePaid(paidEvent, client);

    let cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('reported');

    // 2. 受取人が確認
    client.replies = [];
    client.pushes = [];
    const receivedEvent = makeTextEvent(pair.receiver.lineUserId, '受け取りました');
    await handleReceived(receivedEvent, client);

    cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('confirmed');
    expect(cycle.confirmed_at).not.toBeNull();
  });

  test('D-1-02: pending → overdue（期日超過Cron）', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'pending');

    paymentCycles.markOverdue(cycle.cycleId);

    const updated = db.prepare("SELECT * FROM payment_cycles WHERE id = ?").get(cycle.cycleId);
    expect(updated.status).toBe('overdue');
  });

  test('D-1-03: overdue → reported → confirmed（遅延支払い回復）', async () => {
    const { handlePaid, handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'overdue');

    // 遅延報告
    const paidEvent = makeTextEvent(pair.payer.lineUserId, '振込みました');
    await handlePaid(paidEvent, client);

    let cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('reported');

    // 受取確認
    client.replies = [];
    const receivedEvent = makeTextEvent(pair.receiver.lineUserId, '受け取りました');
    await handleReceived(receivedEvent, client);

    cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('confirmed');
  });

  test('D-1-04: 月またぎ — 旧月cycle維持 + 新月cycle生成', () => {
    const paymentCycles = require('../src/db/paymentCycles');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-03', pair.dueDay, 'confirmed');

    // 新月のサイクルを生成
    paymentCycles.generateMonthlyForAllPairs('2026-04');

    const oldCycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ? AND month = '2026-03'").get(pair.pairId);
    const newCycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ? AND month = '2026-04'").get(pair.pairId);

    expect(oldCycle.status).toBe('confirmed');
    expect(newCycle).toBeDefined();
    expect(newCycle.status).toBe('pending');
  });
});

// ─── D-2: 会話状態遷移 ───────────────────────────────────────

describe('D-2: 会話状態遷移', () => {
  test('D-2-01: 受取人フルフロー（role→name→amount→due_day→confirm→idle）', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    const uid = 'U_full_recv';
    conversationStates.set(uid, 'onboarding_role', {});

    // role → name
    await handleOnboarding(makeTextEvent(uid, '1'), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_name');

    // name → amount
    await handleOnboarding(makeTextEvent(uid, '田中太郎'), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_amount');

    // amount → due_day
    await handleOnboarding(makeTextEvent(uid, '60000'), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_due_day');

    // due_day → confirm
    await handleOnboarding(makeTextEvent(uid, '20'), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_confirm');

    // confirm → idle
    await handleOnboarding(makeTextEvent(uid, 'はい'), client);
    expect(conversationStates.get(uid).state).toBe('idle');
  });

  test('D-2-02: 義務者フルフロー（role→invite_code→name→confirm→idle）', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { v4: uuidv4 } = require('uuid');
    const { encrypt } = require('../src/utils/crypto');

    // 受取人を事前に作成
    const receiverId = uuidv4();
    db.prepare("INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)")
      .run(receiverId, 'U_recv_d2', encrypt('テスト'));
    const inviteCodes = require('../src/db/inviteCodes');
    const inv = inviteCodes.create(receiverId, 50000, 25);

    const uid = 'U_full_payer';
    conversationStates.set(uid, 'onboarding_role', {});

    // role → invite_code
    await handleOnboarding(makeTextEvent(uid, '2'), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_invite_code');

    // invite_code → name
    await handleOnboarding(makeTextEvent(uid, inv.code), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_name');

    // name → confirm
    await handleOnboarding(makeTextEvent(uid, '佐藤次郎'), client);
    expect(conversationStates.get(uid).state).toBe('onboarding_confirm');

    // confirm → idle
    await handleOnboarding(makeTextEvent(uid, 'はい'), client);
    expect(conversationStates.get(uid).state).toBe('idle');
  });

  test('D-2-03: やり直しフロー → role選択に戻りcontextリセット', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');

    const uid = 'U_retry';
    conversationStates.set(uid, 'onboarding_confirm', {
      role: 'receiver', name: 'テスト', amount: 30000, dueDay: 10,
    });

    await handleOnboarding(makeTextEvent(uid, 'いいえ'), client);

    const { state, context } = conversationStates.get(uid);
    expect(state).toBe('onboarding_role');
    expect(context).toEqual({});
  });
});
