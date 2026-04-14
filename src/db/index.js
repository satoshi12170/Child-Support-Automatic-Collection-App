'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const schema = require('./schema');

const DB_PATH = process.env.DB_PATH || './data/app.db';
const dbDir = path.dirname(DB_PATH);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// パフォーマンス設定
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// スキーマ初期化
db.exec(schema);

// マイグレーション: invite_codes に amount/due_day を追加
const inviteCodesInfo = db.prepare('PRAGMA table_info(invite_codes)').all();
const hasAmount = inviteCodesInfo.some(col => col.name === 'amount');
if (!hasAmount) {
  db.exec('ALTER TABLE invite_codes ADD COLUMN amount INTEGER NOT NULL DEFAULT 0');
  db.exec('ALTER TABLE invite_codes ADD COLUMN due_day INTEGER NOT NULL DEFAULT 1');
}

module.exports = db;
