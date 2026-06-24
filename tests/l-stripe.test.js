'use strict';

/**
 * カテゴリ L: Stripe クレジットカード自動引き落とし
 * 根拠：feature/stripe-auto-charge（カード登録・Webhook 保存・期日当日の自動チャージ）
 */

// webhook.js は読み込み時に line.middleware がチャネルシークレットを要求するため
// テスト用のダミー値を設定する（require より前に必要）
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'test_channel_secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'test_channel_token';

const {
  setupTestDb, teardownTestDb, createMockClient,
  makeTextEvent, createPair, createCycle,
} = require('./helpers');

// today() と同じく UTC 基準の YYYY-MM-DD を生成する
function todayParts() {
  const iso = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  const [year, month, day] = iso.split('-');
  return { month: `${year}-${month}`, day: Number(day), dateStr: iso };
}

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── L-1: カード情報の永続化 ──────────────────────────────────

describe('L-1: saveStripeIds', () => {
  test('L-01: カード情報を保存し取得できる', () => {
    const users = require('../src/db/users');
    const pair = createPair(db);

    users.saveStripeIds(pair.payer.lineUserId, 'cus_123', 'pm_456');

    const u = users.getByLineUserId(pair.payer.lineUserId);
    expect(u.stripe_customer_id).toBe('cus_123');
    expect(u.stripe_payment_method_id).toBe('pm_456');
  });

  test('L-02: deactivated ユーザーには保存しない', () => {
    const users = require('../src/db/users');
    const pair = createPair(db);
    db.prepare("UPDATE users SET deactivated_at = datetime('now') WHERE line_user_id = ?")
      .run(pair.payer.lineUserId);

    users.saveStripeIds(pair.payer.lineUserId, 'cus_x', 'pm_x');

    const row = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get(pair.payer.lineUserId);
    expect(row.stripe_customer_id).toBeNull();
  });
});

// ─── L-2: 「カード登録」コマンド ──────────────────────────────

describe('L-2: カード登録コマンド', () => {
  test('L-03: payer の「カード登録」で Checkout URL を返信', async () => {
    jest.doMock('../src/stripe', () => ({
      createCheckoutSession: jest.fn(async () => ({ url: 'https://checkout.stripe.com/test-session' })),
    }));
    const pair = createPair(db);
    const { handleTextMessage } = require('../src/routes/webhook');

    const event = makeTextEvent(pair.payer.lineUserId, 'カード登録');
    await handleTextMessage(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('カード登録');
    expect(text).toContain('https://checkout.stripe.com/test-session');
  });

  test('L-04: receiver の「カード登録」は payer 専用のため案内へフォールバック', async () => {
    jest.doMock('../src/stripe', () => ({ createCheckoutSession: jest.fn() }));
    const pair = createPair(db);
    const { handleTextMessage } = require('../src/routes/webhook');

    const event = makeTextEvent(pair.receiver.lineUserId, 'カード登録');
    await handleTextMessage(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('使えるコマンド');
  });

  test('L-05: Checkout 発行失敗時はエラーメッセージを返す', async () => {
    jest.doMock('../src/stripe', () => ({
      createCheckoutSession: jest.fn(async () => { throw new Error('stripe unavailable'); }),
    }));
    const pair = createPair(db);
    const { handleTextMessage } = require('../src/routes/webhook');

    const event = makeTextEvent(pair.payer.lineUserId, 'カード登録');
    await handleTextMessage(event, client);

    const text = client.getLastReplyText();
    expect(text).toContain('失敗');
  });
});

// ─── L-3: Webhook（checkout.session.completed） ───────────────

describe('L-3: handleCheckoutCompleted', () => {
  test('L-06: setup セッション完了でカード情報を保存', async () => {
    jest.doMock('../src/stripe', () => ({
      stripe: {
        setupIntents: {
          retrieve: jest.fn(async () => ({ payment_method: 'pm_from_setup' })),
        },
      },
    }));
    const users = require('../src/db/users');
    const pair = createPair(db);
    const { handleCheckoutCompleted } = require('../src/routes/stripeWebhook');

    await handleCheckoutCompleted({
      mode: 'setup',
      customer: 'cus_from_session',
      setup_intent: 'seti_1',
      metadata: { line_user_id: pair.payer.lineUserId },
    });

    const u = users.getByLineUserId(pair.payer.lineUserId);
    expect(u.stripe_customer_id).toBe('cus_from_session');
    expect(u.stripe_payment_method_id).toBe('pm_from_setup');
  });

  test('L-07: setup 以外のモードは無視する', async () => {
    jest.doMock('../src/stripe', () => ({
      stripe: { setupIntents: { retrieve: jest.fn() } },
    }));
    const users = require('../src/db/users');
    const pair = createPair(db);
    const { handleCheckoutCompleted } = require('../src/routes/stripeWebhook');
    const { stripe } = require('../src/stripe');

    await handleCheckoutCompleted({
      mode: 'payment',
      customer: 'cus_x',
      metadata: { line_user_id: pair.payer.lineUserId },
    });

    expect(stripe.setupIntents.retrieve).not.toHaveBeenCalled();
    const u = users.getByLineUserId(pair.payer.lineUserId);
    expect(u.stripe_customer_id).toBeNull();
  });
});

// ─── L-4: 期日当日の自動チャージ（runDailyReminders） ─────────

describe('L-4: 期日当日の自動チャージ', () => {
  test('L-08: カード登録済みなら自動チャージし confirmed になる', async () => {
    const chargeCard = jest.fn(async () => ({ id: 'pi_1' }));
    jest.doMock('../src/stripe', () => ({ chargeCard }));
    jest.doMock('../src/routes/webhook', () => ({ client: { pushMessage: jest.fn() } }));

    const users = require('../src/db/users');
    const { month, day } = todayParts();
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, month, day, 'pending');
    users.saveStripeIds(pair.payer.lineUserId, 'cus_a', 'pm_a');

    const { runDailyReminders } = require('../src/jobs/reminders');
    await runDailyReminders();

    expect(chargeCard).toHaveBeenCalledTimes(1);
    const updated = db.prepare('SELECT * FROM payment_cycles WHERE id = ?').get(cycle.cycleId);
    expect(updated.status).toBe('confirmed');
  });

  test('L-09: チャージ失敗時は pending のまま', async () => {
    const chargeCard = jest.fn(async () => { throw new Error('card_declined'); });
    jest.doMock('../src/stripe', () => ({ chargeCard }));
    jest.doMock('../src/routes/webhook', () => ({ client: { pushMessage: jest.fn() } }));

    const users = require('../src/db/users');
    const { month, day } = todayParts();
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, month, day, 'pending');
    users.saveStripeIds(pair.payer.lineUserId, 'cus_a', 'pm_a');

    const { runDailyReminders } = require('../src/jobs/reminders');
    await runDailyReminders();

    expect(chargeCard).toHaveBeenCalledTimes(1);
    const updated = db.prepare('SELECT * FROM payment_cycles WHERE id = ?').get(cycle.cycleId);
    expect(updated.status).toBe('pending');
  });

  test('L-10: カード未登録ならチャージせず pending のまま', async () => {
    const chargeCard = jest.fn();
    jest.doMock('../src/stripe', () => ({ chargeCard }));
    jest.doMock('../src/routes/webhook', () => ({ client: { pushMessage: jest.fn() } }));

    const { month, day } = todayParts();
    const pair = createPair(db);
    const cycle = createCycle(db, pair.pairId, month, day, 'pending');

    const { runDailyReminders } = require('../src/jobs/reminders');
    await runDailyReminders();

    expect(chargeCard).not.toHaveBeenCalled();
    const updated = db.prepare('SELECT * FROM payment_cycles WHERE id = ?').get(cycle.cycleId);
    expect(updated.status).toBe('pending');
  });
});
