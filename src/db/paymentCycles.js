'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('./index');

/**
 * 月文字列 "YYYY-MM" と期日日を受け取り、due_date "YYYY-MM-DD" を返す
 */
function buildDueDate(month, dueDay) {
  return `${month}-${String(dueDay).padStart(2, '0')}`;
}

/**
 * 現在の「対象月」を決定する。
 * ペア作成時・コマンド受信時に呼ぶ。
 * 今月の期日がまだ来ていなければ今月、過ぎていれば来月を返す。
 */
function resolveCurrentMonth(dueDay) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const today = now.getDate();

  if (today <= dueDay) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  // 来月
  const nextDate = new Date(year, month, 1); // month is 0-based here
  const ny = nextDate.getFullYear();
  const nm = nextDate.getMonth() + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function create(pairId, month, dueDay) {
  const id = uuidv4();
  const dueDate = buildDueDate(month, dueDay);
  db.prepare(`
    INSERT OR IGNORE INTO payment_cycles (id, pair_id, month, due_date, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(id, pairId, month, dueDate);
  return getByMonth(pairId, month);
}

function getByMonth(pairId, month) {
  return db.prepare(`
    SELECT * FROM payment_cycles WHERE pair_id = ? AND month = ?
  `).get(pairId, month);
}

/**
 * 現在対象月のサイクルを取得または作成する
 */
function getOrCreateCurrent(pairId, dueDay) {
  const month = resolveCurrentMonth(dueDay);
  const existing = getByMonth(pairId, month);
  if (existing) return existing;
  return create(pairId, month, dueDay);
}

/**
 * 全アクティブペアに対して当月分サイクルを生成する（月初Cronから呼ぶ）
 */
function generateMonthlyForAllPairs(month) {
  const pairs = db.prepare(
    "SELECT id, due_day FROM pairs WHERE status = 'active'"
  ).all();
  for (const pair of pairs) {
    create(pair.id, month, pair.due_day);
  }
  return pairs.length;
}

function reportPaid(id) {
  db.prepare(`
    UPDATE payment_cycles
    SET status = 'reported', reported_at = datetime('now')
    WHERE id = ? AND status IN ('pending', 'overdue')
  `).run(id);
}

function confirmReceived(id) {
  db.prepare(`
    UPDATE payment_cycles
    SET status = 'confirmed', confirmed_at = datetime('now')
    WHERE id = ? AND status = 'reported'
  `).run(id);
}

function markOverdue(id) {
  db.prepare(`
    UPDATE payment_cycles
    SET status = 'overdue'
    WHERE id = ? AND status = 'pending'
  `).run(id);
}

/**
 * 期日超過かつ未報告のサイクルを全件取得（リマインダCronから使う）
 */
function getOverduePending() {
  return db.prepare(`
    SELECT pc.*, p.receiver_id, p.payer_id, p.amount, p.due_day,
      ru.line_user_id AS receiver_line_user_id,
      pu.line_user_id AS payer_line_user_id
    FROM payment_cycles pc
    JOIN pairs p ON p.id = pc.pair_id
    JOIN users ru ON ru.id = p.receiver_id
    JOIN users pu ON pu.id = p.payer_id
    WHERE pc.status = 'pending'
      AND pc.due_date < date('now')
  `).all();
}

/**
 * 指定ペアの直近N件の履歴を取得
 */
function getHistory(pairId, limit = 6) {
  return db.prepare(`
    SELECT * FROM payment_cycles
    WHERE pair_id = ?
    ORDER BY month DESC
    LIMIT ?
  `).all(pairId, limit);
}

module.exports = {
  create,
  getByMonth,
  getOrCreateCurrent,
  generateMonthlyForAllPairs,
  reportPaid,
  confirmReceived,
  markOverdue,
  getOverduePending,
  getHistory,
  resolveCurrentMonth,
};
