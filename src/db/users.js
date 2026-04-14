'use strict';

const { v4: uuidv4 } = require('uuid');
const db = require('./index');
const { encrypt, decrypt } = require('../utils/crypto');

function getByLineUserId(lineUserId) {
  const row = db.prepare('SELECT * FROM users WHERE line_user_id = ?').get(lineUserId);
  if (!row) return null;
  return { ...row, name: decrypt(row.name) };
}

function create({ lineUserId, role, name }) {
  const id = uuidv4();
  db.prepare(`
    INSERT INTO users (id, line_user_id, role, name)
    VALUES (?, ?, ?, ?)
  `).run(id, lineUserId, role, encrypt(name));
  return { id, lineUserId, role, name };
}

module.exports = { getByLineUserId, create };
