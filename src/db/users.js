'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('./index');
const { encrypt, decrypt } = require('../utils/crypto');

// ─── 参照系 ───────────────────────────────────────────────────

// アクティブ（未ブロック）なユーザーのみ返す
function getByLineUserId(lineUserId) {
  const row = db.prepare(
    'SELECT * FROM users WHERE line_user_id = ? AND deactivated_at IS NULL'
  ).get(lineUserId);
  if (!row) return null;
  return { ...row, name: decrypt(row.name) };
}

// deactivated を含めて取得（unfollow/follow のライフサイクル判定用）
function findAnyByLineUserId(lineUserId) {
  const row = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get(lineUserId);
  if (!row) return null;
  return { ...row, name: decrypt(row.name) };
}

// ─── 更新系 ───────────────────────────────────────────────────

// 新規作成 or 既存 deactivated ユーザーの再アクティベーション。
// 既存レコードがある場合は id を保持したまま UPDATE することで、
// 過去の pair / payment_cycles / invite_codes の FK 参照を壊さず履歴を残す。
function create({ lineUserId, role, name }) {
  const existing = db.prepare(
    'SELECT id FROM users WHERE line_user_id = ?'
  ).get(lineUserId);

  if (existing) {
    // 再登録: 既存 id を再利用して role/name/作成日時/deactivated_at を上書き
    db.prepare(`
      UPDATE users
      SET role = ?, name = ?, deactivated_at = NULL, created_at = datetime('now')
      WHERE id = ?
    `).run(role, encrypt(name), existing.id);
    return { id: existing.id, lineUserId, role, name };
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO users (id, line_user_id, role, name)
    VALUES (?, ?, ?, ?)
  `).run(id, lineUserId, role, encrypt(name));
  return { id, lineUserId, role, name };
}

// ユーザーをブロック済みとしてマークする（soft delete）
function deactivateByLineUserId(lineUserId) {
  const result = db.prepare(`
    UPDATE users
    SET deactivated_at = datetime('now')
    WHERE line_user_id = ? AND deactivated_at IS NULL
  `).run(lineUserId);
  return result.changes > 0;
}

module.exports = { getByLineUserId, findAnyByLineUserId, create, deactivateByLineUserId };
