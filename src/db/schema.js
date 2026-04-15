'use strict';

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    line_user_id TEXT UNIQUE NOT NULL,
    role TEXT CHECK(role IN ('receiver', 'payer')) NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    deactivated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS invite_codes (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    receiver_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL DEFAULT 0,
    due_day INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS pairs (
    id TEXT PRIMARY KEY,
    receiver_id TEXT NOT NULL REFERENCES users(id),
    payer_id TEXT NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'ended')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_cycles (
    id TEXT PRIMARY KEY,
    pair_id TEXT NOT NULL REFERENCES pairs(id),
    month TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reported', 'confirmed', 'overdue')),
    reported_at TEXT,
    confirmed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS conversation_states (
    line_user_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'idle',
    context TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

module.exports = schema;
