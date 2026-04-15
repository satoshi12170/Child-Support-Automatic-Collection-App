'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('./index');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 紛らわしい文字を除外
  return Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

function create(receiverId, amount, dueDay) {
  const id = uuidv4();
  let code;
  // コード衝突を避けるためにループ
  for (let i = 0; i < 5; i++) {
    code = generateCode();
    const exists = db.prepare('SELECT id FROM invite_codes WHERE code = ?').get(code);
    if (!exists) break;
  }
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO invite_codes (id, code, receiver_id, amount, due_day, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, code, receiverId, amount, dueDay, expiresAt);
  return { id, code, expiresAt };
}

function findValid(code) {
  return db.prepare(`
    SELECT ic.*, u.line_user_id AS receiver_line_user_id
    FROM invite_codes ic
    JOIN users u ON u.id = ic.receiver_id
    WHERE ic.code = ?
      AND ic.used_at IS NULL
      AND ic.expires_at > datetime('now')
  `).get(code);
}

function markUsed(id) {
  db.prepare(`
    UPDATE invite_codes SET used_at = datetime('now') WHERE id = ?
  `).run(id);
}

// 指定 receiver の未使用招待コードを一括で無効化
// （unfollow時、宙に浮いた招待コードを使えなくするためのクリーンアップ）
function invalidateByReceiverId(receiverId) {
  const result = db.prepare(`
    UPDATE invite_codes
    SET used_at = datetime('now')
    WHERE receiver_id = ? AND used_at IS NULL
  `).run(receiverId);
  return result.changes;
}

module.exports = { create, findValid, markUsed, invalidateByReceiverId };
