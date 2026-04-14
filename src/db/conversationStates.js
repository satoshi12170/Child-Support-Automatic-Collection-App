'use strict';

const db = require('./index');

function get(lineUserId) {
  const row = db.prepare(
    'SELECT * FROM conversation_states WHERE line_user_id = ?'
  ).get(lineUserId);
  if (!row) return { state: 'idle', context: {} };
  return { state: row.state, context: JSON.parse(row.context) };
}

function set(lineUserId, state, context = {}) {
  db.prepare(`
    INSERT INTO conversation_states (line_user_id, state, context, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(line_user_id) DO UPDATE SET
      state = excluded.state,
      context = excluded.context,
      updated_at = excluded.updated_at
  `).run(lineUserId, state, JSON.stringify(context));
}

function reset(lineUserId) {
  set(lineUserId, 'idle', {});
}

module.exports = { get, set, reset };
