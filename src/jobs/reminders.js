'use strict';

const cron = require('node-cron');
const paymentCycles = require('../db/paymentCycles');
const { client } = require('../routes/webhook');

// ─── 通知文言 ─────────────────────────────────────────────────

const MESSAGES = {
  reminder3DaysBefore: (amount, dueDate) =>
    `⏰ 支払いリマインド\n\n養育費の支払い期日（${dueDate}）まで3日です。\n\n💰 金額：${amount.toLocaleString()}円\n\n期日までに振込みを完了し、「振込みました」と送信してください。`,

  reminderDueDay: (amount, dueDate) =>
    `🔔 本日が支払い期日です\n\n本日（${dueDate}）は養育費の支払い期日です。\n\n💰 金額：${amount.toLocaleString()}円\n\n振込み後は「振込みました」と送信してください。`,

  alertDayAfterPayer: (amount, dueDate) =>
    `🚨 支払い期日超過のお知らせ\n\n${dueDate}が支払い期日でしたが、まだ振込みの報告が確認できていません。\n\n💰 金額：${amount.toLocaleString()}円\n\n速やかに振込みを行い、「振込みました」と送信してください。`,

  alertDayAfterReceiver: (amount, dueDate) =>
    `🚨 入金未確認のお知らせ\n\n${dueDate}が支払い期日でしたが、義務者からの振込み報告がまだありません。\n\n💰 金額：${amount.toLocaleString()}円\n\n引き続き確認をお願いします。`,

  alertDay8Payer: (amount, dueDate) =>
    `🚨【二次催促】支払い期日超過\n\n${dueDate}の支払い期日から8日が経過しました。\n\n💰 未払い金額：${amount.toLocaleString()}円\n\n至急振込みを行い、「振込みました」と送信してください。`,

  alertDay8Receiver: (amount, dueDate) =>
    `🚨【二次催促】入金未確認\n\n${dueDate}の支払い期日から8日が経過しましたが、振込み報告がありません。\n\n💰 金額：${amount.toLocaleString()}円\n\n法的手続きの検討もご検討ください。`,
};

// ─── 日付ユーティリティ ───────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── リマインダ本体 ───────────────────────────────────────────

async function runDailyReminders() {
  const todayStr = today();
  console.log(`[cron] running daily reminders for ${todayStr}`);

  const cycles = await getAllActiveCycles();

  let sent = 0;
  for (const cycle of cycles) {
    const { due_date, status, amount, payer_line_user_id, receiver_line_user_id } = cycle;

    // 期日3日前（未払い）
    if (addDays(due_date, -3) === todayStr && status === 'pending') {
      await push(payer_line_user_id, MESSAGES.reminder3DaysBefore(amount, due_date));
      sent++;
    }

    // 期日当日（未払い）
    if (due_date === todayStr && status === 'pending') {
      await push(payer_line_user_id, MESSAGES.reminderDueDay(amount, due_date));
      sent++;
    }

    // 期日翌日（未払い）→ overdue に遷移
    if (addDays(due_date, 1) === todayStr && status === 'pending') {
      paymentCycles.markOverdue(cycle.id);
      await push(payer_line_user_id, MESSAGES.alertDayAfterPayer(amount, due_date));
      await push(receiver_line_user_id, MESSAGES.alertDayAfterReceiver(amount, due_date));
      sent += 2;
    }

    // 期日8日後（overdue のまま）
    if (addDays(due_date, 8) === todayStr && status === 'overdue') {
      await push(payer_line_user_id, MESSAGES.alertDay8Payer(amount, due_date));
      await push(receiver_line_user_id, MESSAGES.alertDay8Receiver(amount, due_date));
      sent += 2;
    }
  }

  console.log(`[cron] reminders done: ${sent} message(s) sent`);
}

async function runMonthlyGeneration() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const count = paymentCycles.generateMonthlyForAllPairs(month);
  console.log(`[cron] monthly generation: ${count} pair(s) processed for ${month}`);
}

// ─── ヘルパー ─────────────────────────────────────────────────

function getAllActiveCycles() {
  const db = require('../db');
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

async function push(lineUserId, text) {
  // Cronリマインダのpush失敗は[ALERT]ログで監視・対応できるようにする。
  // 個別送信の失敗が他ユーザーへの送信を止めないよう、ここでエラーは握るが
  // 必ずログには残し、リトライや再送の根拠を保持する。
  try {
    await client.pushMessage({ to: lineUserId, messages: [{ type: 'text', text }] });
  } catch (pushErr) {
    console.error(`[ALERT] Cron push failed | recipientId=${lineUserId} error=${pushErr.message}`);
  }
}

// ─── Cronジョブ登録 ──────────────────────────────────────────

function startJobs() {
  // 毎日 08:00 にリマインダ実行
  cron.schedule('0 8 * * *', runDailyReminders, { timezone: 'Asia/Tokyo' });

  // 毎月1日 00:05 に翌月サイクル生成
  cron.schedule('5 0 1 * *', runMonthlyGeneration, { timezone: 'Asia/Tokyo' });

  console.log('[cron] jobs registered: daily reminders (08:00 JST), monthly generation (1st 00:05 JST)');
}

module.exports = { startJobs, runDailyReminders, runMonthlyGeneration };
