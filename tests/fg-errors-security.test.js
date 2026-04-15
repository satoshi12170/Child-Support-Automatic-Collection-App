'use strict';

/**
 * カテゴリ F: エラーハンドリング / G: セキュリティテスト
 * 根拠：詳細設計 §5, §6、非機能要件 §3
 */

const {
  setupTestDb, teardownTestDb, createMockClient,
  makeTextEvent, createPair, createCycle, createReceiver,
} = require('./helpers');

let db, client;

beforeEach(() => {
  db = setupTestDb();
  client = createMockClient();
});

afterEach(() => {
  teardownTestDb(db);
});

// ─── F: エラーハンドリング ────────────────────────────────────

describe('F: エラーハンドリング', () => {
  test('F-03: 未登録ユーザーのコマンド → UnregisteredUserError', async () => {
    const { handlePaid } = require('../src/handlers/payment');
    const { UnregisteredUserError } = require('../src/utils/errors');

    const event = makeTextEvent('U_nonexist', '振込みました');
    await expect(handlePaid(event, client)).rejects.toThrow(UnregisteredUserError);
  });

  test('F-04: 不正な招待コード → InvalidInviteCodeError', async () => {
    const { handleOnboarding } = require('../src/handlers/onboarding');
    const conversationStates = require('../src/db/conversationStates');
    const { InvalidInviteCodeError } = require('../src/utils/errors');

    conversationStates.set('U_test', 'onboarding_invite_code', { role: 'payer' });
    const event = makeTextEvent('U_test', 'BADCODE1');

    await expect(handleOnboarding(event, client)).rejects.toThrow(InvalidInviteCodeError);
  });

  test('F-06: ペアなし状態でコマンド → NoCycleError', async () => {
    const { handleStatus } = require('../src/handlers/payment');
    const { NoCycleError } = require('../src/utils/errors');

    // ユーザーは登録済みだがペアなし
    createReceiver(db, 'U_no_pair');
    const event = makeTextEvent('U_no_pair', '状況');
    await expect(handleStatus(event, client)).rejects.toThrow(NoCycleError);
  });

  test('F-07: LINE_ERROR_MESSAGES に全エラー種別の文言がある', () => {
    const { LINE_ERROR_MESSAGES } = require('../src/utils/errors');

    expect(LINE_ERROR_MESSAGES.UnregisteredUserError).toContain('登録');
    expect(LINE_ERROR_MESSAGES.InvalidInviteCodeError).toContain('招待コード');
    expect(LINE_ERROR_MESSAGES.NoCycleError).toContain('サイクル');
    expect(LINE_ERROR_MESSAGES.DatabaseError).toContain('システムエラー');
  });

  test('F: カスタムエラークラスの継承チェック', () => {
    const {
      AppError, SignatureError, UnregisteredUserError,
      InvalidInviteCodeError, NoCycleError, DatabaseError,
    } = require('../src/utils/errors');

    expect(new SignatureError('test')).toBeInstanceOf(AppError);
    expect(new UnregisteredUserError('test')).toBeInstanceOf(AppError);
    expect(new InvalidInviteCodeError('test')).toBeInstanceOf(AppError);
    expect(new NoCycleError('test')).toBeInstanceOf(AppError);
    expect(new DatabaseError('test')).toBeInstanceOf(AppError);

    // name プロパティ
    expect(new SignatureError('test').name).toBe('SignatureError');
    expect(new DatabaseError('test').name).toBe('DatabaseError');
  });
});

// ─── G: セキュリティ ──────────────────────────────────────────

describe('G: セキュリティ', () => {
  test('G-03: 個人情報暗号化確認 — DBに平文で保存されない', () => {
    const users = require('../src/db/users');
    users.create({ lineUserId: 'U_encrypt_test', role: 'receiver', name: '暗号化テスト太郎' });

    // DBから直接読み取り
    const row = db.prepare("SELECT name FROM users WHERE line_user_id = 'U_encrypt_test'").get();
    // 平文ではない
    expect(row.name).not.toBe('暗号化テスト太郎');
    // iv:tag:cipher形式
    expect(row.name.split(':')).toHaveLength(3);

    // 復号して元に戻ること
    const decrypted = users.getByLineUserId('U_encrypt_test');
    expect(decrypted.name).toBe('暗号化テスト太郎');
  });

  test('G-03: 暗号化はAES-256-GCM', () => {
    const { encrypt, decrypt } = require('../src/utils/crypto');

    const plaintext = 'テスト個人情報';
    const encrypted = encrypt(plaintext);

    // iv:authTag:ciphertext 形式
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toHaveLength(24); // 12バイト = 24hex
    expect(parts[1]).toHaveLength(32); // 16バイト = 32hex

    // 復号
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  test('G-03: 同じ平文を暗号化しても毎回異なるIVが使われる', () => {
    const { encrypt } = require('../src/utils/crypto');

    const enc1 = encrypt('同じテキスト');
    const enc2 = encrypt('同じテキスト');

    expect(enc1).not.toBe(enc2);
    // IVが異なる
    expect(enc1.split(':')[0]).not.toBe(enc2.split(':')[0]);
  });

  test('G-04: 他ユーザーデータ分離 — findByUserIdが正しいペアのみ返す', () => {
    const pairs = require('../src/db/pairs');
    const pair1 = createPair(db, { receiverLineId: 'U_r1', payerLineId: 'U_p1' });
    const pair2 = createPair(db, { receiverLineId: 'U_r2', payerLineId: 'U_p2' });

    const result1 = pairs.findByUserId(pair1.receiver.id);
    const result2 = pairs.findByUserId(pair2.payer.id);

    expect(result1.id).toBe(pair1.pairId);
    expect(result2.id).toBe(pair2.pairId);
    expect(result1.id).not.toBe(result2.id);
  });

  test('G-08: 口座情報非収集 — スキーマに口座関連カラムがない', () => {
    const tables = db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").all();
    const allSql = tables.map(t => t.sql).join(' ');

    expect(allSql).not.toContain('account_number');
    expect(allSql).not.toContain('bank_');
    expect(allSql).not.toContain('routing');
  });
});
