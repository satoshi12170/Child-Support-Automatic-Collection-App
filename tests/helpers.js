'use strict';

/**
 * テスト共通ヘルパー
 * - インメモリSQLiteで各テストを独立実行
 * - Jest の jest.doMock でDBモジュールを差し替え
 * - LINE clientのモック
 * - イベント生成ユーティリティ
 */

const Database = require('better-sqlite3');
const path = require('path');

// schema は production コードに依存しないよう直接読み込み
const schema = require('../src/db/schema');

// ─── DB セットアップ（テスト毎にインメモリDB） ─────────────────

function setupTestDb() {
  // Jest のモジュールレジストリをリセットし、全 src/ モジュールを再ロード可能にする
  jest.resetModules();

  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);

  // マイグレーション: invite_codes に amount/due_day を追加（本番と同じ）
  const inviteCodesInfo = db.prepare('PRAGMA table_info(invite_codes)').all();
  const hasAmount = inviteCodesInfo.some(col => col.name === 'amount');
  if (!hasAmount) {
    db.exec('ALTER TABLE invite_codes ADD COLUMN amount INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE invite_codes ADD COLUMN due_day INTEGER NOT NULL DEFAULT 1');
  }

  // jest.doMock で src/db/index を差し替え
  // 以降の require('../src/db/...') は全てこの db を使う
  jest.doMock('../src/db/index', () => db);

  return db;
}

function teardownTestDb(db) {
  db.close();
}

// ─── LINE クライアント モック ──────────────────────────────────

function createMockClient() {
  const replies = [];
  const pushes = [];

  return {
    replies,
    pushes,
    replyMessage: jest.fn((replyToken, message) => {
      replies.push({ replyToken, message });
      return Promise.resolve({});
    }),
    pushMessage: jest.fn((params) => {
      pushes.push(params);
      return Promise.resolve({});
    }),
    createRichMenu: jest.fn(() => Promise.resolve({ richMenuId: 'test-menu-id' })),
    setDefaultRichMenu: jest.fn(() => Promise.resolve({})),
    linkRichMenuIdToUser: jest.fn(() => Promise.resolve({})),
    getLastReplyText() {
      if (replies.length === 0) return null;
      const last = replies[replies.length - 1];
      return last.message.text || null;
    },
    getLastPushText() {
      if (pushes.length === 0) return null;
      const last = pushes[pushes.length - 1];
      return last.messages?.[0]?.text || null;
    },
  };
}

// ─── LINE イベント生成 ─────────────────────────────────────────

function makeFollowEvent(userId = 'U_test_user') {
  return {
    type: 'follow',
    replyToken: 'test-reply-token',
    source: { userId, type: 'user' },
    timestamp: Date.now(),
  };
}

function makeUnfollowEvent(userId = 'U_test_user') {
  return {
    type: 'unfollow',
    source: { userId, type: 'user' },
    timestamp: Date.now(),
  };
}

function makeTextEvent(userId, text) {
  return {
    type: 'message',
    replyToken: `reply-${Date.now()}`,
    source: { userId, type: 'user' },
    message: { type: 'text', id: `msg-${Date.now()}`, text },
    timestamp: Date.now(),
  };
}

// ─── テストデータ生成 ──────────────────────────────────────────

/**
 * 受取人を作成し登録完了状態にする
 */
function createReceiver(db, lineUserId = 'U_receiver') {
  const crypto = require('crypto');
  const { encrypt } = require('../src/utils/crypto');
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'receiver', ?)
  `).run(id, lineUserId, encrypt('テスト受取人'));
  db.prepare(`
    INSERT OR REPLACE INTO conversation_states (line_user_id, state, context, updated_at)
    VALUES (?, 'idle', '{}', datetime('now'))
  `).run(lineUserId);
  return { id, lineUserId };
}

/**
 * 義務者を作成し登録完了状態にする
 */
function createPayer(db, lineUserId = 'U_payer') {
  const crypto = require('crypto');
  const { encrypt } = require('../src/utils/crypto');
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO users (id, line_user_id, role, name) VALUES (?, ?, 'payer', ?)
  `).run(id, lineUserId, encrypt('テスト義務者'));
  db.prepare(`
    INSERT OR REPLACE INTO conversation_states (line_user_id, state, context, updated_at)
    VALUES (?, 'idle', '{}', datetime('now'))
  `).run(lineUserId);
  return { id, lineUserId };
}

/**
 * ペアを作成する（受取人+義務者+active pair）
 */
function createPair(db, options = {}) {
  const crypto = require('crypto');
  const amount = options.amount || 50000;
  const dueDay = options.dueDay || 25;

  const receiver = createReceiver(db, options.receiverLineId || 'U_receiver');
  const payer = createPayer(db, options.payerLineId || 'U_payer');

  const pairId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO pairs (id, receiver_id, payer_id, amount, due_day, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(pairId, receiver.id, payer.id, amount, dueDay);

  return { pairId, receiver, payer, amount, dueDay };
}

/**
 * 支払いサイクルを作成する
 */
function createCycle(db, pairId, month, dueDay, status = 'pending') {
  const crypto = require('crypto');
  const cycleId = crypto.randomUUID();
  const dueDate = `${month}-${String(dueDay).padStart(2, '0')}`;
  db.prepare(`
    INSERT INTO payment_cycles (id, pair_id, month, due_date, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(cycleId, pairId, month, dueDate, status);
  return { cycleId, month, dueDate, status };
}

module.exports = {
  setupTestDb,
  teardownTestDb,
  createMockClient,
  makeFollowEvent,
  makeUnfollowEvent,
  makeTextEvent,
  createReceiver,
  createPayer,
  createPair,
  createCycle,
};
