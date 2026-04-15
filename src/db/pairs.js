'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('./index');

function create({ receiverId, payerId, amount, dueDay }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO pairs (id, receiver_id, payer_id, amount, due_day)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, receiverId, payerId, amount, dueDay);

  // 初回サイクルを即時生成（循環依存を避けるためインライン実装）
  const paymentCycles = require('./paymentCycles');
  paymentCycles.getOrCreateCurrent(id, dueDay);

  return { id, receiverId, payerId, amount, dueDay, status: 'active' };
}

function findByUserId(userId) {
  return db.prepare(`
    SELECT p.*,
      ru.line_user_id AS receiver_line_user_id,
      pu.line_user_id AS payer_line_user_id
    FROM pairs p
    JOIN users ru ON ru.id = p.receiver_id
    JOIN users pu ON pu.id = p.payer_id
    WHERE (p.receiver_id = ? OR p.payer_id = ?)
      AND p.status = 'active'
  `).get(userId, userId);
}

// 指定ユーザーが含まれるアクティブペアを ended に遷移
// （unfollow時のクリーンアップに使用。両側の pair を含む）
function endByUserId(userId) {
  const result = db.prepare(`
    UPDATE pairs
    SET status = 'ended'
    WHERE (receiver_id = ? OR payer_id = ?) AND status = 'active'
  `).run(userId, userId);
  return result.changes;
}

module.exports = { create, findByUserId, endByUserId };
