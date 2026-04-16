'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ─── PII マスク ───────────────────────────────────────────────
// LINE ユーザーID (U + 32 hex) は先頭8文字＋… に短縮して追跡可能性を残す
// 名前は絶対にログに含めない（呼び出し側が渡さない設計）

function maskUserId(userId) {
  if (!userId || typeof userId !== 'string') return 'unknown';
  // "U1234567890abcdef..." → "U1234567..."
  return userId.length > 9 ? `${userId.slice(0, 9)}...` : userId;
}

// ─── フォーマット ─────────────────────────────────────────────

const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DDTHH:mm:ssZ' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// ─── トランスポート ───────────────────────────────────────────

const rotateOptions = {
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxFiles: '30d',
  auditFile: path.join(LOG_DIR, '.audit.json'),
};

const allFileTransport = new winston.transports.DailyRotateFile({
  ...rotateOptions,
  filename: path.join(LOG_DIR, 'app-%DATE%.log'),
  level: 'info',
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  ...rotateOptions,
  filename: path.join(LOG_DIR, 'error-%DATE%.log'),
  level: 'error',
});

// 本番環境でも stdout へ出力する（Railwayなどのクラウド環境でログを収集するため）
// ファイルログは追加的に保存（コンテナ再起動で失われるが補助用途）
const transports = [
  new winston.transports.Console({ format: consoleFormat }),
  allFileTransport,
  errorFileTransport,
];

// ─── ロガー ───────────────────────────────────────────────────

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: baseFormat,
  transports,
});

// ─── 構造化ログヘルパー ───────────────────────────────────────

/**
 * 操作ログ（主要なビジネスイベント）
 * @param {string} action - イベント種別 (e.g. 'user.follow', 'payment.reported')
 * @param {object} meta   - 追加情報（PII 非含有のフィールドのみ）
 */
function logOperation(action, meta = {}) {
  const masked = {};
  for (const [k, v] of Object.entries(meta)) {
    masked[k] = k === 'userId' ? maskUserId(v) : v;
  }
  logger.info(action, { category: 'operation', ...masked });
}

/**
 * エラーログ
 * @param {string} context - エラー発生箇所 (e.g. 'webhook', 'cron')
 * @param {Error}  err     - エラーオブジェクト
 * @param {object} meta    - 追加情報（PII 非含有のフィールドのみ）
 */
function logError(context, err, meta = {}) {
  const masked = {};
  for (const [k, v] of Object.entries(meta)) {
    masked[k] = k === 'userId' ? maskUserId(v) : v;
  }
  logger.error(`[${context}] ${err.message}`, {
    category: 'error',
    errorName: err.name || 'UnknownError',
    stack: err.stack,
    ...masked,
  });
}

/**
 * セキュリティログ（署名検証失敗など）
 */
function logSecurity(message, meta = {}) {
  logger.warn(message, { category: 'security', ...meta });
}

module.exports = { logger, logOperation, logError, logSecurity, maskUserId };
