'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const { handleFollow, handleUnfollow } = require('../handlers/follow');
const { handleOnboarding } = require('../handlers/onboarding');
const { handlePaid, handleReceived, handleStatus, handleHistory } = require('../handlers/payment');
const conversationStates = require('../db/conversationStates');
const users = require('../db/users');
const pairs = require('../db/pairs');
const {
  DatabaseError,
  LINE_ERROR_MESSAGES,
} = require('../utils/errors');

const router = express.Router();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const _rawClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: lineConfig.channelAccessToken,
});

// LINE SDK v11 は replyMessage({ replyToken, messages: [...] }) 形式だが
// 各ハンドラは replyMessage(replyToken, message) の旧形式で書かれているため
// 互換ラッパーで吸収する
const client = new Proxy(_rawClient, {
  get(target, prop) {
    if (prop === 'replyMessage') {
      return (replyTokenOrRequest, message) => {
        if (typeof replyTokenOrRequest === 'string') {
          // 旧形式: replyMessage(replyToken, message)
          return target.replyMessage({
            replyToken: replyTokenOrRequest,
            messages: Array.isArray(message) ? message : [message],
          });
        }
        // 新形式: replyMessage({ replyToken, messages }) をそのままパススルー
        return target.replyMessage(replyTokenOrRequest);
      };
    }
    const val = target[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  },
});

// ─── Webhookルート（LINE Signature検証 → イベント処理） ───────────

router.post(
  '/',
  line.middleware(lineConfig),
  async (req, res) => {
    // 各イベントは handleEvent 内で完結してエラーを握りつぶさない
    await Promise.all(req.body.events.map(event => handleEvent(event)));
    res.json({ ok: true });
  }
);

// ─── 署名検証失敗エラーハンドラ（Express error middleware） ────────
// line.middleware() が next(err) で渡してくるエラーをここで捕捉する

router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const isSignatureError =
    err.name === 'SignatureValidationFailed' ||
    err.name === 'SignatureError' ||
    (err.message && /signature/i.test(err.message));

  if (isSignatureError) {
    console.error(`[security] Signature validation failed | ip=${req.ip} ua=${req.headers['user-agent']}`);
    return res.status(400).json({ error: 'invalid signature' });
  }

  // その他の予期せぬミドルウェアエラー
  console.error('[webhook] unexpected middleware error:', err);
  res.status(500).json({ error: 'internal server error' });
});

// ─── イベント処理（エラーは集中キャッチ） ───────────────────────

async function handleEvent(event) {
  const lineUserId = event.source?.userId;
  console.log(`[event] type=${event.type} userId=${lineUserId}`);

  try {
    switch (event.type) {
      case 'follow':
        return await handleFollow(event, client);

      case 'unfollow':
        return await handleUnfollow(event, client);

      case 'message':
        if (event.message.type === 'text') {
          return await handleTextMessage(event, client);
        }
        break;

      default:
        break;
    }
  } catch (err) {
    await handleEventError(err, event, lineUserId);
  }
}

// ─── 集中エラーハンドラ ──────────────────────────────────────────

async function handleEventError(err, event, lineUserId) {
  // SQLiteランタイムエラー → DatabaseError に変換
  if (err.code && (err.code.startsWith('SQLITE_') || err.code === 'ERR_SQLITE')) {
    err = new DatabaseError(err.message);
  }

  const errType = err.name || 'UnknownError';
  console.error(`[error] type=${errType} userId=${lineUserId} message=${err.message}`);

  // DBエラーはアラートとして強調ログ
  if (err instanceof DatabaseError) {
    console.error('[ALERT] Database error - manual investigation required:', err.stack);
  }

  // ユーザー向けメッセージが定義されているエラー種別はLINE返答
  const userMsg = LINE_ERROR_MESSAGES[errType];
  if (userMsg && event.replyToken) {
    try {
      await client.replyMessage(event.replyToken, { type: 'text', text: userMsg });
    } catch (replyErr) {
      console.error('[error] Failed to send error reply:', replyErr.message);
    }
  }
}

// ─── テキストメッセージルーティング ─────────────────────────────

async function handleTextMessage(event, client) {
  const lineUserId = event.source.userId;
  const { state } = conversationStates.get(lineUserId);

  // オンボーディング中はオンボーディングハンドラへ
  if (state.startsWith('onboarding_')) {
    return handleOnboarding(event, client);
  }

  // 未登録ユーザーはオンボーディングへ誘導
  const user = users.getByLineUserId(lineUserId);
  if (!user) {
    conversationStates.set(lineUserId, 'onboarding_role', {});
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '最初に役割を選択してください。\n\n1️⃣ 受取人（養育費を受け取る側）\n2️⃣ 支払い義務者（養育費を支払う側）\n\n「1」または「2」と送信してください。',
    });
  }

  // 登録済みだがアクティブペアを持たない = ペアリング未完了のまま放置された孤立状態。
  // コマンドを実行してもサイクルが無くエラーになるだけなので、再登録へ誘導する。
  const activePair = pairs.findByUserId(user.id);
  if (!activePair) {
    console.log(`[event] text from orphaned user, routing to re-onboarding | userId=${lineUserId}`);
    conversationStates.set(lineUserId, 'onboarding_role', {});
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ペアリングが完了していないようです。最初からやり直しましょう。\n\n1️⃣ 受取人（養育費を受け取る側）\n2️⃣ 支払い義務者（養育費を支払う側）\n\n「1」または「2」と送信してください。',
    });
  }

  // 登録済みユーザー向けコマンド
  const text = event.message.text.trim();
  if (text === '振込みました') return handlePaid(event, client);
  if (text === '受け取りました') return handleReceived(event, client);
  if (text === '状況') return handleStatus(event, client);
  if (text === '履歴') return handleHistory(event, client);

  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: '使えるコマンド：\n・「振込みました」\n・「受け取りました」\n・「状況」\n・「履歴」',
  });
}

module.exports = { router, client, handleTextMessage };
