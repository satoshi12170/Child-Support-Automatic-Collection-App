'use strict';

const line = require('@line/bot-sdk');
const { generateDefaultMenuImage, generateReceiverMenuImage, generatePayerMenuImage } = require('./richMenuImage');
const { logOperation, logError } = require('../utils/logger');

// rich menu 画像アップロード専用クライアント（MessagingApiBlobClient）
let blobClient = null;
function getBlobClient() {
  if (!blobClient) {
    blobClient = new line.messagingApi.MessagingApiBlobClient({
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    });
  }
  return blobClient;
}

// ─── リッチメニュー定義 ───────────────────────────────────────

const AREA_W = 625;
const HEIGHT  = 843;

function menuAreas(visibleCommands) {
  const all = [
    { label: '振込みました', text: '振込みました', x: 0 },
    { label: '受け取りました', text: '受け取りました', x: AREA_W },
    { label: '状況確認',   text: '状況',       x: AREA_W * 2 },
    { label: '支払い履歴', text: '履歴',       x: AREA_W * 3 },
  ];
  return all.map(a => ({
    bounds: { x: a.x, y: 0, width: AREA_W, height: HEIGHT },
    action: visibleCommands.includes(a.text)
      ? { type: 'message', label: a.label, text: a.text }
      : { type: 'message', label: a.label, text: a.text }, // 全員タップ可（グレーは視覚的区別のみ）
  }));
}

function buildMenuBody(name, chatBarText) {
  return {
    size: { width: 2500, height: HEIGHT },
    selected: true,
    name,
    chatBarText,
    areas: menuAreas(['振込みました', '受け取りました', '状況', '履歴']),
  };
}

// ─── セットアップ ─────────────────────────────────────────────

let richMenuIds = {}; // { default, receiver, payer }

async function setupRichMenus(client) {
  try {
    const menus = [
      {
        key: 'default',
        name: 'デフォルトメニュー',
        chatBarText: 'メニューを開く',
        image: generateDefaultMenuImage(),
      },
      {
        key: 'receiver',
        name: '受取人メニュー',
        chatBarText: '受取人メニュー',
        image: generateReceiverMenuImage(),
      },
      {
        key: 'payer',
        name: '義務者メニュー',
        chatBarText: '義務者メニュー',
        image: generatePayerMenuImage(),
      },
    ];

    for (const menu of menus) {
      const body = buildMenuBody(menu.name, menu.chatBarText);
      const { richMenuId } = await client.createRichMenu(body);

      const blob = new Blob([menu.image], { type: 'image/png' });
      await getBlobClient().setRichMenuImage(richMenuId, blob);

      richMenuIds[menu.key] = richMenuId;
      logOperation('richMenu.created', { key: menu.key, richMenuId });
    }

    // デフォルトメニューを全ユーザーに適用
    await client.setDefaultRichMenu(richMenuIds.default);
    logOperation('richMenu.defaultSet', { richMenuId: richMenuIds.default });
  } catch (err) {
    logError('richMenu.setup', err);
  }
}

/**
 * 登録完了後にロール別メニューをユーザーに設定する
 * @param {string} lineUserId
 * @param {'receiver'|'payer'} role
 */
async function setUserRichMenu(client, lineUserId, role) {
  const menuId = richMenuIds[role];
  if (!menuId) return; // セットアップ未完了の場合はスキップ
  try {
    await client.linkRichMenuIdToUser(lineUserId, menuId);
    logOperation('richMenu.linked', { userId: lineUserId, role, menuId });
  } catch (err) {
    logError('richMenu.link', err, { userId: lineUserId });
  }
}

module.exports = { setupRichMenus, setUserRichMenu };
