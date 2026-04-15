'use strict';

const db = require('../db');
const users = require('../db/users');
const pairs = require('../db/pairs');
const inviteCodes = require('../db/inviteCodes');
const conversationStates = require('../db/conversationStates');

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

// ─── 共通クリーンアップ ────────────────────────────────────────

// unfollow時 / follow時の「再登録が必要」判定時に呼ぶ共通処理。
// ペアを ended に、招待コードを無効化、ユーザーを deactivate、会話状態をリセット。
// トランザクションで一気に掃除して中途半端な状態を残さない。
function runCleanup(user, lineUserId) {
  const tx = db.transaction(() => {
    if (user) {
      pairs.endByUserId(user.id);
      if (user.role === 'receiver') {
        inviteCodes.invalidateByReceiverId(user.id);
      }
      users.deactivateByLineUserId(lineUserId);
    }
    conversationStates.reset(lineUserId);
  });
  tx();
}

// ─── follow: 友だち追加／ブロック解除後の再追加 ─────────────────

async function handleFollow(event, client) {
  const lineUserId = event.source.userId;

  // アクティブな既存ユーザー
  const activeUser = users.getByLineUserId(lineUserId);
  if (activeUser) {
    // 相方とのアクティブペアがあれば通常の復帰
    const activePair = pairs.findByUserId(activeUser.id);
    if (activePair) {
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

    // アクティブだがアクティブペアを持たない = ペアリング未完了でブロックされた等、
    // unfollow イベントが届かず孤立したレコードが残っているケース。
    // 強制的にクリーンアップして再登録フローに入れる。
    console.log(`[event] follow with orphaned active user, running recovery cleanup | userId=${lineUserId}`);
    runCleanup(activeUser, lineUserId);
  }

  // 未登録、または deactivated、または孤立状態のユーザー → オンボーディング
  conversationStates.set(lineUserId, 'onboarding_role', {});

  return client.replyMessage(event.replyToken, WELCOME_MESSAGE);
}

// ─── unfollow: ブロック／友だち削除 ───────────────────────────

// replyToken が使えない（unfollow はサイレント）ため push もしない。
// DB クリーンアップのみを行い、次の follow で再登録可能な状態にする。
// なお LINE は unfollow を確実には配信しないため、handleFollow 側でも
// 同等のリカバリ処理を行っている（多重実行しても冪等）。
async function handleUnfollow(event /* , client */) {
  const lineUserId = event.source.userId;
  const anyUser = users.findAnyByLineUserId(lineUserId);
  runCleanup(anyUser, lineUserId);
  const role = anyUser ? anyUser.role : 'unknown';
  console.log(`[event] unfollow cleanup done | userId=${lineUserId} role=${role}`);
}

module.exports = { handleFollow, handleUnfollow };
