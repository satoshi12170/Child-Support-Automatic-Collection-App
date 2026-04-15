'use strict';

const express = require('express');
const line = require('@line/bot-sdk');
const { handleFollow, handleUnfollow, WELCOME_MESSAGE, runCleanup } = require('../handlers/follow');
const { handleOnboarding } = require('../handlers/onboarding');
const { handlePaid, handleReceived, handleStatus, handleHistory } = require('../handlers/payment');
const conversationStates = require('../db/conversationStates');
const users = require('../db/users');
const pairs = require('../db/pairs');
const {
  DatabaseError,
  LINE_ERROR_MESSAGES,
} = require('../utils/errors');
const { logOperation, logError, logSecurity } = require('../utils/logger');

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
    logSecurity('Signature validation failed', { ip: req.ip, ua: req.headers['user-agent'] });
    return res.status(400).json({ error: 'invalid signature' });
  }

  // その他の予期せぬミドルウェアエラー
  logError('webhook.middleware', err);
  res.status(500).json({ error: 'internal server error' });
});

// ─── イベント処理（エラーは集中キャッチ） ───────────────────────

async function handleEvent(event) {
  const lineUserId = event.source?.userId;

  try {
    switch (event.type) {
      case 'follow':
        logOperation('user.follow', { userId: lineUserId });
        return await handleFollow(event, client);

      case 'unfollow':
        return await handleUnfollow(event, client);

      case 'message':
        if (event.message.type === 'text') {
          logOperation('message.text', { userId: lineUserId });
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

  logError('event', err, { userId: lineUserId });

  // DBエラーはアラートとして強調ログ
  if (err instanceof DatabaseError) {
    logError('event.database.ALERT', err, { userId: lineUserId, alert: true });
  }

  // ユーザー向けメッセージが定義されているエラー種別はLINE返答
  const userMsg = LINE_ERROR_MESSAGES[err.name || 'UnknownError'];
  if (userMsg && event.replyToken) {
    try {
      await client.replyMessage(event.replyToken, { type: 'text', text: userMsg });
    } catch (replyErr) {
      logError('event.replyMessage', replyErr, { userId: lineUserId });
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

  // 未登録ユーザー（初回 or ブロック後 follow イベントが未着）→ 最初のフローへ
  const user = users.getByLineUserId(lineUserId);
  if (!user) {
    conversationStates.set(lineUserId, 'onboarding_role', {});
    return client.replyMessage(event.replyToken, WELCOME_MESSAGE);
  }

  // 登録済みだがアクティブペアなし = 孤立状態（パートナーが離脱など）。
  // クリーンアップして最初のフローへ（follow イベントと同じ挙動）。
  const activePair = pairs.findByUserId(user.id);
  if (!activePair) {
    logOperation('user.orphaned.re-onboarding', { userId: lineUserId });
    runCleanup(user, lineUserId);
    conversationStates.set(lineUserId, 'onboarding_role', {});
    return client.replyMessage(event.replyToken, WELCOME_MESSAGE);
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
