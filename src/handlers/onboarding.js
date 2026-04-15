'use strict';

const conversationStates = require('../db/conversationStates');
const users = require('../db/users');
const inviteCodes = require('../db/inviteCodes');
const pairs = require('../db/pairs');
const { InvalidInviteCodeError } = require('../utils/errors');
const { setUserRichMenu } = require('../line/richMenu');

// ─── クイックリプライ定義 ─────────────────────────────────────

const QR_YES_NO = {
  quickReply: {
    items: [
      { type: 'action', action: { type: 'message', label: 'はい', text: 'はい' } },
      { type: 'action', action: { type: 'message', label: 'いいえ（やり直し）', text: 'いいえ' } },
    ],
  },
};

const QR_ROLE = {
  quickReply: {
    items: [
      { type: 'action', action: { type: 'message', label: '1️⃣ 受取人', text: '1' } },
      { type: 'action', action: { type: 'message', label: '2️⃣ 支払い義務者', text: '2' } },
    ],
  },
};

// ─── 受取人フロー ────────────────────────────────────────────

async function handleOnboardingRole(lineUserId, text, replyToken, client) {
  if (text === '1') {
    conversationStates.set(lineUserId, 'onboarding_name', { role: 'receiver' });
    return client.replyMessage(replyToken, {
      type: 'text',
      text: 'あなたのお名前（フルネーム）を入力してください。\n例：山田 花子',
    });
  }

  if (text === '2') {
    conversationStates.set(lineUserId, 'onboarding_invite_code', { role: 'payer' });
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '招待コードを入力してください。\n\n招待コードは受取人が発行した8桁のコードです。',
    });
  }

  return client.replyMessage(replyToken, {
    type: 'text',
    text: '「1」または「2」を送信してください。\n\n1️⃣ 受取人（養育費を受け取る側）\n2️⃣ 支払い義務者（養育費を支払う側）',
    ...QR_ROLE,
  });
}

async function handleOnboardingName(lineUserId, text, context, replyToken, client) {
  const name = text.trim();
  if (name.length < 1 || name.length > 50) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: 'お名前は1〜50文字で入力してください。',
    });
  }

  if (context.role === 'receiver') {
    conversationStates.set(lineUserId, 'onboarding_amount', { ...context, name });
    return client.replyMessage(replyToken, {
      type: 'text',
      text: `${name} さん、ありがとうございます。\n\n毎月の養育費の金額を入力してください（円単位）。\n例：50000`,
    });
  }

  // payer: name → confirm
  conversationStates.set(lineUserId, 'onboarding_confirm', { ...context, name });
  const inv = inviteCodes.findValid(context.inviteCode);
  return client.replyMessage(replyToken, {
    type: 'text',
    text: `以下の内容で登録します。\n\n━━━━━━━━━━━━━━━\n👤 あなたの名前：${name}\n💰 毎月の金額：${inv.amount.toLocaleString()}円\n📅 支払い期日：毎月${inv.due_day}日\n━━━━━━━━━━━━━━━\n\n「はい」で登録、「いいえ」でやり直し`,
    ...QR_YES_NO,
  });
}

async function handleOnboardingAmount(lineUserId, text, context, replyToken, client) {
  const amount = parseInt(text.replace(/,/g, ''), 10);
  if (isNaN(amount) || amount < 1000 || amount > 10000000) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '金額は1,000円〜10,000,000円の範囲で入力してください。\n例：50000',
    });
  }

  conversationStates.set(lineUserId, 'onboarding_due_day', { ...context, amount });
  return client.replyMessage(replyToken, {
    type: 'text',
    text: `毎月の支払い期日を入力してください（1〜28の数字）。\n例：25（毎月25日）`,
  });
}

async function handleOnboardingDueDay(lineUserId, text, context, replyToken, client) {
  const dueDay = parseInt(text, 10);
  if (isNaN(dueDay) || dueDay < 1 || dueDay > 28) {
    return client.replyMessage(replyToken, {
      type: 'text',
      text: '支払い期日は1〜28の数字で入力してください。\n例：25',
    });
  }

  conversationStates.set(lineUserId, 'onboarding_confirm', { ...context, dueDay });
  return client.replyMessage(replyToken, {
    type: 'text',
    text: `以下の内容で登録します。\n\n━━━━━━━━━━━━━━━\n👤 あなたの名前：${context.name}\n💰 毎月の金額：${context.amount.toLocaleString()}円\n📅 支払い期日：毎月${dueDay}日\n━━━━━━━━━━━━━━━\n\n「はい」で登録、「いいえ」でやり直し`,
    ...QR_YES_NO,
  });
}

async function handleOnboardingInviteCode(lineUserId, text, context, replyToken, client) {
  const code = text.trim().toUpperCase();
  const inv = inviteCodes.findValid(code);

  if (!inv) {
    throw new InvalidInviteCodeError(`Invalid invite code: ${code}`);
  }

  conversationStates.set(lineUserId, 'onboarding_name', { ...context, inviteCode: code });
  return client.replyMessage(replyToken, {
    type: 'text',
    text: `招待コードを確認しました。\n\n💰 毎月の養育費：${inv.amount.toLocaleString()}円\n📅 支払い期日：毎月${inv.due_day}日\n\nあなたのお名前（フルネーム）を入力してください。\n例：山田 太郎`,
  });
}

async function handleOnboardingConfirm(lineUserId, text, context, replyToken, client) {
  const answer = text.trim();

  if (answer !== 'はい') {
    conversationStates.set(lineUserId, 'onboarding_role', {});
    return client.replyMessage(replyToken, {
      type: 'text',
      text: 'やり直します。\n\n「1」または「2」で役割を選択してください。\n\n1️⃣ 受取人\n2️⃣ 支払い義務者',
      ...QR_ROLE,
    });
  }

  if (context.role === 'receiver') {
    const user = users.create({
      lineUserId,
      role: 'receiver',
      name: context.name,
    });
    const inv = inviteCodes.create(user.id, context.amount, context.dueDay);
    conversationStates.reset(lineUserId);
    setUserRichMenu(client, lineUserId, 'receiver');

    return client.replyMessage(replyToken, {
      type: 'text',
      text: `登録が完了しました！\n\n━━━━━━━━━━━━━━━\n招待コード\n\n🔑 ${inv.code}\n\n━━━━━━━━━━━━━━━\nこのコードを支払い義務者に共有してください。\n\n有効期限：48時間\n（期限後は「招待コード発行」と送信してください）`,
    });
  }

  // payer
  const inv = inviteCodes.findValid(context.inviteCode);
  if (!inv) {
    conversationStates.reset(lineUserId);
    throw new InvalidInviteCodeError(`Invite code expired at confirm step: ${context.inviteCode}`);
  }

  const payerUser = users.create({
    lineUserId,
    role: 'payer',
    name: context.name,
  });
  pairs.create({
    receiverId: inv.receiver_id,
    payerId: payerUser.id,
    amount: inv.amount,
    dueDay: inv.due_day,
  });
  inviteCodes.markUsed(inv.id);
  conversationStates.reset(lineUserId);

  // リッチメニュー切替（失敗しても登録は成功済みのためログのみ）
  try {
    await setUserRichMenu(client, lineUserId, 'payer');
  } catch (menuErr) {
    console.error(`[ALERT] Failed to link rich menu | userId=${lineUserId} error=${menuErr.message}`);
  }

  // 義務者への登録完了メッセージ（replyTokenは30秒で失効するため先に送る）
  const replyResult = await client.replyMessage(replyToken, {
    type: 'text',
    text: `登録が完了しました！\n\n━━━━━━━━━━━━━━━\n💰 毎月の養育費：${inv.amount.toLocaleString()}円\n📅 支払い期日：毎月${inv.due_day}日\n━━━━━━━━━━━━━━━\n\n支払い期日が近づくとリマインドが届きます。\n支払い後は「振込みました」と送信してください。`,
  });

  // 受取人へプッシュ通知（awaitして完了を待つ）
  // ペアリングDB更新は既に成功しているため、push失敗時もエラーを呼び出し元に
  // 伝播させない。ただし[ALERT]ログで監視・対応できるようにする。
  try {
    await client.pushMessage({
      to: inv.receiver_line_user_id,
      messages: [{
        type: 'text',
        text: `✅ ペアリング完了！\n\n支払い義務者が登録を完了しました。\n\n━━━━━━━━━━━━━━━\n💰 毎月の養育費：${inv.amount.toLocaleString()}円\n📅 支払い期日：毎月${inv.due_day}日\n━━━━━━━━━━━━━━━\n\n支払い期日が近づくとリマインドが届きます。`,
      }],
    });
  } catch (pushErr) {
    console.error(`[ALERT] Failed to notify receiver of pairing completion | receiverId=${inv.receiver_line_user_id} payerId=${lineUserId} error=${pushErr.message}`);
  }

  return replyResult;
}

// ─── メインディスパッチャ ──────────────────────────────────────

async function handleOnboarding(event, client) {
  const lineUserId = event.source.userId;
  const text = event.message.text;
  const replyToken = event.replyToken;
  const { state, context } = conversationStates.get(lineUserId);

  switch (state) {
    case 'onboarding_role':
      return handleOnboardingRole(lineUserId, text, replyToken, client);
    case 'onboarding_name':
      return handleOnboardingName(lineUserId, text, context, replyToken, client);
    case 'onboarding_amount':
      return handleOnboardingAmount(lineUserId, text, context, replyToken, client);
    case 'onboarding_due_day':
      return handleOnboardingDueDay(lineUserId, text, context, replyToken, client);
    case 'onboarding_invite_code':
      return handleOnboardingInviteCode(lineUserId, text, context, replyToken, client);
    case 'onboarding_confirm':
      return handleOnboardingConfirm(lineUserId, text, context, replyToken, client);
    default:
      return null;
  }
}

module.exports = { handleOnboarding };
