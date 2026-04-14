'use strict';

const db = require('../db');

const WELCOME_MESSAGE = {
  type: 'text',
  text: `養育費集金サポートへようこそ！

このサービスでは、養育費の支払い管理を
LINEだけでシンプルに行えます。

━━━━━━━━━━━━━━━
あなたの役割を教えてください。

1️⃣ 受取人（養育費を受け取る側）
2️⃣ 支払い義務者（養育費を支払う側）`,
  quickReply: {
    items: [
      {
        type: 'action',
        action: { type: 'message', label: '1️⃣ 受取人', text: '1' },
      },
      {
        type: 'action',
        action: { type: 'message', label: '2️⃣ 支払い義務者', text: '2' },
      },
    ],
  },
};

async function handleFollow(event, client) {
  const lineUserId = event.source.userId;

  // 既存ユーザーチェック
  const existing = db.prepare(
    'SELECT id FROM users WHERE line_user_id = ?'
  ).get(lineUserId);

  if (existing) {
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'おかえりなさい！\n\n「振込みました」「受け取りました」「状況」「履歴」のコマンドをご利用ください。',
      quickReply: {
        items: [
          { type: 'action', action: { type: 'message', label: '状況', text: '状況' } },
          { type: 'action', action: { type: 'message', label: '履歴', text: '履歴' } },
        ],
      },
    });
  }

  // 会話状態を初期化
  db.prepare(`
    INSERT INTO conversation_states (line_user_id, state, context, updated_at)
    VALUES (?, 'onboarding_role', '{}', datetime('now'))
    ON CONFLICT(line_user_id) DO UPDATE SET
      state = 'onboarding_role',
      context = '{}',
      updated_at = datetime('now')
  `).run(lineUserId);

  return client.replyMessage(event.replyToken, WELCOME_MESSAGE);
}

module.exports = { handleFollow };
