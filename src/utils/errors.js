'use strict';

// ─── カスタム例外クラス（DR#7 §5 エラーハンドリング） ─────────────

class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** 1. Webhook署名検証失敗 — HTTP 400 を返しログに記録 */
class SignatureError extends AppError {}

/** 2. 未登録ユーザーのコマンド使用 */
class UnregisteredUserError extends AppError {}

/** 3. 招待コード不正・期限切れ */
class InvalidInviteCodeError extends AppError {}

/** 4. 当月サイクルが存在しない */
class NoCycleError extends AppError {}

/** 5. DB接続・クエリエラー */
class DatabaseError extends AppError {}

// ─── ユーザー向け返答文言 ────────────────────────────────────────

const LINE_ERROR_MESSAGES = {
  UnregisteredUserError:
    'まず登録をお願いします。\n\n「1」または「2」と送信して役割を選択してください。\n\n1️⃣ 受取人\n2️⃣ 支払い義務者',
  InvalidInviteCodeError:
    '招待コードが無効または期限切れです。\n\n受取人に再発行を依頼し、正しいコードを入力してください。',
  NoCycleError:
    '現在の支払いサイクルが見つかりません。\n\n「状況」と送信して現在の状況をご確認ください。',
  DatabaseError:
    'システムエラーが発生しました。\n\nしばらくお待ちいただき、再度お試しください。\nご不便をおかけして申し訳ありません。',
};

module.exports = {
  AppError,
  SignatureError,
  UnregisteredUserError,
  InvalidInviteCodeError,
  NoCycleError,
  DatabaseError,
  LINE_ERROR_MESSAGES,
};
