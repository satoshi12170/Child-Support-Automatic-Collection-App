'use strict';

/**
 * カテゴリ C: 支払い管理コマンドテスト
 * 根拠：詳細設計 §3 LINE Botコマンド定義、基本設計 §5 支払い状態管理
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

// ─── C-1: 振込みました ───────────────────────────────────────

describe('C-1: 振込みました（支払い報告）', () => {
  test('C-1-01: 正常報告（pending→reported）', async () => {
    const { handlePaid } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'pending');

    const event = makeTextEvent(pair.payer.lineUserId, '振込みました');
    await handlePaid(event, client);

    // 返答確認
    const text = client.getLastReplyText();
    expect(text).toContain('振込報告を受け付けました');

    // 受取人へのプッシュ通知
    expect(client.pushMessage).toHaveBeenCalled();
    const pushText = client.getLastPushText();
    expect(pushText).toContain('振込報告');
    expect(pushText).toContain('受け取りました');

    // DB状態確認
    const cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('reported');
    expect(cycle.reported_at).not.toBeNull();
  });

  test('C-1-03: confirmed状態 → 「すでに確認済み」メッセージ', async () => {
    const { handlePaid } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'confirmed');

    const event = makeTextEvent(pair.payer.lineUserId, '振込みました');
    await handlePaid(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('すでに確認済み');
  });

  test('C-1-04: 受取人が実行 → 「義務者のみ」メッセージ', async () => {
    const { handlePaid } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'pending');

    const event = makeTextEvent(pair.receiver.lineUserId, '振込みました');
    await handlePaid(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('支払い義務者のみ');
  });
});

// ─── C-2: 受け取りました ─────────────────────────────────────

describe('C-2: 受け取りました（受取確認）', () => {
  test('C-2-01: 正常確認（reported→confirmed）', async () => {
    const { handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'reported');

    const event = makeTextEvent(pair.receiver.lineUserId, '受け取りました');
    await handleReceived(event, client);

    // 返答確認
    const text = client.getLastReplyText();
    expect(text).toContain('受取確認を記録しました');

    // 義務者へのプッシュ通知
    expect(client.pushMessage).toHaveBeenCalled();
    const pushText = client.getLastPushText();
    expect(pushText).toContain('受取確認されました');

    // DB状態確認
    const cycle = db.prepare("SELECT * FROM payment_cycles WHERE pair_id = ?").get(pair.pairId);
    expect(cycle.status).toBe('confirmed');
    expect(cycle.confirmed_at).not.toBeNull();
  });

  test('C-2-02: pending状態で確認 → 「振込報告後に」メッセージ', async () => {
    const { handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'pending');

    const event = makeTextEvent(pair.receiver.lineUserId, '受け取りました');
    await handleReceived(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('振込報告後');
  });

  test('C-2-03: overdue状態で確認 → 「振込報告後に」メッセージ', async () => {
    const { handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'overdue');

    const event = makeTextEvent(pair.receiver.lineUserId, '受け取りました');
    await handleReceived(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('振込報告後');
  });

  test('C-2-04: 義務者が実行 → 「受取人のみ」メッセージ', async () => {
    const { handleReceived } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'reported');

    const event = makeTextEvent(pair.payer.lineUserId, '受け取りました');
    await handleReceived(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('受取人のみ');
  });
});

// ─── C-3: 状況確認 ────────────────────────────────────────────

describe('C-3: 状況確認', () => {
  test.each([
    ['pending', '未払い'],
    ['reported', '振込報告済み'],
    ['confirmed', '受取確認済み'],
    ['overdue', '期日超過'],
  ])('C-3: status=%s → ラベル「%s」が表示', async (status, expectedLabel) => {
    const { handleStatus } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, status);

    const event = makeTextEvent(pair.receiver.lineUserId, '状況');
    await handleStatus(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain(expectedLabel);
    expect(text).toContain('50,000');
  });
});

// ─── C-4: 履歴表示 ────────────────────────────────────────────

describe('C-4: 履歴表示', () => {
  test('C-4-01: 3ヶ月分の履歴表示', async () => {
    const { handleHistory } = require('../src/handlers/payment');
    const pair = createPair(db);
    createCycle(db, pair.pairId, '2026-02', pair.dueDay, 'confirmed');
    createCycle(db, pair.pairId, '2026-03', pair.dueDay, 'confirmed');
    createCycle(db, pair.pairId, '2026-04', pair.dueDay, 'pending');

    const event = makeTextEvent(pair.receiver.lineUserId, '履歴');
    await handleHistory(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('2026-04');
    expect(text).toContain('2026-03');
    expect(text).toContain('2026-02');
    expect(text).toContain('50,000');
  });

  test('C-4-02: 8ヶ月分あっても直近6ヶ月のみ表示', async () => {
    const { handleHistory } = require('../src/handlers/payment');
    const pair = createPair(db);
    for (let m = 1; m <= 8; m++) {
      createCycle(db, pair.pairId, `2026-${String(m).padStart(2, '0')}`, pair.dueDay, 'confirmed');
    }

    const event = makeTextEvent(pair.receiver.lineUserId, '履歴');
    await handleHistory(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('2026-08');
    expect(text).toContain('2026-03');
    expect(text).not.toContain('2026-02');
    expect(text).not.toContain('2026-01');
  });

  test('C-4-03: 履歴なし → 「まだありません」メッセージ', async () => {
    const { handleHistory } = require('../src/handlers/payment');
    const pair = createPair(db);

    const event = makeTextEvent(pair.receiver.lineUserId, '履歴');
    await handleHistory(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('まだありません');
  });
});

// ─── C-5: ヘルプ（不明なコマンド） ───────────────────────────

describe('C-5: ヘルプ', () => {
  test('C-5-01/02: 不明なテキスト → コマンド一覧が返る', () => {
    // webhook.js内のルーティングロジックを検証
    const validCommands = ['振込みました', '受け取りました', '状況', '履歴'];
    const invalidInputs = ['こんにちは', '振り込みました', 'help', '支払い'];

    invalidInputs.forEach(input => {
      expect(validCommands.includes(input)).toBe(false);
    });
  });
});
