'use strict';

const users = require('../db/users');
const pairs = require('../db/pairs');
const paymentCycles = require('../db/paymentCycles');
const { UnregisteredUserError, NoCycleError } = require('../utils/errors');

const STATUS_LABEL = {
  pending: '⏳ 未払い',
  reported: '📨 振込報告済み（受取人確認待ち）',
  confirmed: '✅ 受取確認済み',
  overdue: '🚨 期日超過・未払い',
};

// ─── 振込みました ──────────────────────────────────────────────

async function handlePaid(event, client) {
  const lineUserId = event.source.userId;
  const user = users.getByLineUserId(lineUserId);
  if (!user) throw new UnregisteredUserError(`Unregistered user: ${lineUserId}`);
  if (user.role !== 'payer') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'このコマンドは支払い義務者のみ使用できます。',
    });
  }

  const pair = pairs.findByUserId(user.id);
  if (!pair) throw new NoCycleError(`No active pair for user: ${user.id}`);

  const cycle = paymentCycles.getOrCreateCurrent(pair.id, pair.due_day);
  if (!cycle) throw new NoCycleError(`Could not create/find cycle for pair: ${pair.id}`);

  if (cycle.status === 'confirmed') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `今月（${cycle.month}）の養育費はすでに確認済みです。\n\n受取人が受取を確認しています。`,
    });
  }

  paymentCycles.reportPaid(cycle.id);

  // 受取人へプッシュ通知（クイックリプライ付き）
  client.pushMessage({
    to: pair.receiver_line_user_id,
    messages: [{
      type: 'text',
      text: `📨 振込報告がありました\n\n${cycle.month}分の養育費（${pair.amount.toLocaleString()}円）の振込報告が届きました。\n\n入金を確認したら「受け取りました」と送信してください。`,
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '✅ 受け取りました', text: '受け取りました' } },
          { type: 'action', action: { type: 'message', label: '📊 状況確認', text: '状況' } },
        ],
      },
    }],
  }).catch(err => console.error('[push] receiver paid-notify failed:', err));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `✅ 振込報告を受け付けました\n\n${cycle.month}分（${pair.amount.toLocaleString()}円）\n\n受取人が確認すると通知が届きます。`,
  });
}

// ─── 受け取りました ────────────────────────────────────────────

async function handleReceived(event, client) {
  const lineUserId = event.source.userId;
  const user = users.getByLineUserId(lineUserId);
  if (!user) throw new UnregisteredUserError(`Unregistered user: ${lineUserId}`);
  if (user.role !== 'receiver') {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'このコマンドは受取人のみ使用できます。',
    });
  }

  const pair = pairs.findByUserId(user.id);
  if (!pair) throw new NoCycleError(`No active pair for user: ${user.id}`);

  const cycle = paymentCycles.getOrCreateCurrent(pair.id, pair.due_day);
  if (!cycle) throw new NoCycleError(`Could not create/find cycle for pair: ${pair.id}`);

  if (cycle.status !== 'reported') {
    const label = STATUS_LABEL[cycle.status] || cycle.status;
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: `今月（${cycle.month}）の支払い状態は「${label}」です。\n\n義務者の振込報告後に「受け取りました」を送信してください。`,
    });
  }

  paymentCycles.confirmReceived(cycle.id);

  // 義務者へプッシュ通知
  client.pushMessage({
    to: pair.payer_line_user_id,
    messages: [{
      type: 'text',
      text: `✅ 受取確認されました\n\n${cycle.month}分の養育費（${pair.amount.toLocaleString()}円）の受取が確認されました。`,
    }],
  }).catch(err => console.error('[push] payer confirm-notify failed:', err));

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `✅ 受取確認を記録しました\n\n${cycle.month}分（${pair.amount.toLocaleString()}円）\n\n義務者に通知しました。`,
  });
}

// ─── 状況 ──────────────────────────────────────────────────────

async function handleStatus(event, client) {
  const lineUserId = event.source.userId;
  const user = users.getByLineUserId(lineUserId);
  if (!user) throw new UnregisteredUserError(`Unregistered user: ${lineUserId}`);

  const pair = pairs.findByUserId(user.id);
  if (!pair) throw new NoCycleError(`No active pair for user: ${user.id}`);

  const cycle = paymentCycles.getOrCreateCurrent(pair.id, pair.due_day);
  if (!cycle) throw new NoCycleError(`Could not create/find cycle for pair: ${pair.id}`);
  const label = STATUS_LABEL[cycle.status] || cycle.status;

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `📊 ${cycle.month}の支払い状況\n\n━━━━━━━━━━━━━━━\n💰 金額：${pair.amount.toLocaleString()}円\n📅 期日：${cycle.due_date}\n📌 状態：${label}\n━━━━━━━━━━━━━━━`,
  });
}

// ─── 履歴 ──────────────────────────────────────────────────────

async function handleHistory(event, client) {
  const lineUserId = event.source.userId;
  const user = users.getByLineUserId(lineUserId);
  if (!user) throw new UnregisteredUserError(`Unregistered user: ${lineUserId}`);

  const pair = pairs.findByUserId(user.id);
  if (!pair) throw new NoCycleError(`No active pair for user: ${user.id}`);

  const history = paymentCycles.getHistory(pair.id, 6);
  if (history.length === 0) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '支払い履歴はまだありません。',
    });
  }

  const lines = history.map(c => {
    const label = STATUS_LABEL[c.status] || c.status;
    return `${c.month}　${label}`;
  });

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: `📋 支払い履歴（直近6ヶ月）\n\n━━━━━━━━━━━━━━━\n${lines.join('\n')}\n━━━━━━━━━━━━━━━\n💰 月額：${pair.amount.toLocaleString()}円`,
  });
}

module.exports = { handlePaid, handleReceived, handleStatus, handleHistory };
