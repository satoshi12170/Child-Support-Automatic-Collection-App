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

// ─── follow: 友だち追加／ブロック解除後の再追加 ─────────────────

async function handleFollow(event, client) {
  const lineUserId = event.source.userId;

  // アクティブな既存ユーザー（ブロック経験なし or 再登録済み）
  const activeUser = users.getByLineUserId(lineUserId);
  if (activeUser) {
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

  // 未登録、または過去にブロックされ deactivated 状態のユーザー
  // → 会話状態をリセットしてオンボーディングをやり直す
  //   deactivated レコード自体は残し、users.create 時に UPDATE で再アクティベートする
  conversationStates.set(lineUserId, 'onboarding_role', {});

  return client.replyMessage(event.replyToken, WELCOME_MESSAGE);
}

// ─── unfollow: ブロック／友だち削除 ───────────────────────────

// replyToken が使えない（unfollow はサイレント）ため push もしない。
// DB クリーンアップのみを行い、次の follow で再登録可能な状態にする。
async function handleUnfollow(event /* , client */) {
  const lineUserId = event.source.userId;
  const anyUser = users.findAnyByLineUserId(lineUserId);
  if (!anyUser) {
    // 未登録のまま block された場合は会話状態のみ掃除
    conversationStates.reset(lineUserId);
    return;
  }

  // トランザクションで一気に soft-delete。部分更新を避け整合性を担保する。
  const tx = db.transaction(() => {
    // ペアを ended に。相手側も同じ pair を共有しているため自動的に無効化される。
    pairs.endByUserId(anyUser.id);
    // 受取人の場合、発行済み招待コードを無効化
    if (anyUser.role === 'receiver') {
      inviteCodes.invalidateByReceiverId(anyUser.id);
    }
    // ユーザーを deactivated に（再 follow 時に新規オンボーディング扱い）
    users.deactivateByLineUserId(lineUserId);
    // 会話状態をクリア
    conversationStates.reset(lineUserId);
  });
  tx();

  console.log(`[event] unfollow cleanup done | userId=${lineUserId} role=${anyUser.role}`);
}

module.exports = { handleFollow, handleUnfollow };
