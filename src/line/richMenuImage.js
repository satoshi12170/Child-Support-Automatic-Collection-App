'use strict';

/**
 * 追加ライブラリなしで 2500x843px の PNG を生成する。
 * Node.js 組み込み zlib（deflate）を使用。
 */
const zlib = require('zlib');

// ─── CRC32（PNG チャンクに必要） ──────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xFFFFFFFF) >>> 0;
  const result = Buffer.alloc(4);
  result.writeUInt32BE(crc, 0);
  return result;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBytes, data]);
  return Buffer.concat([u32(data.length), typeBytes, data, crc32(combined)]);
}

// ─── PNG 生成 ────────────────────────────────────────────────

/**
 * sections: Array<{ r, g, b, width }> — 左から並ぶカラーセクション
 * height: 画像の高さ（px）
 */
function generateRichMenuPNG(sections, height) {
  const totalWidth = sections.reduce((s, sec) => s + sec.width, 0);
  const DIVIDER = { r: 180, g: 180, b: 180 };
  const DIVIDER_WIDTH = 2;

  // 1行分のピクセルデータを先に作る（全行共通）
  const rowPixels = Buffer.alloc(totalWidth * 3);
  let x = 0;
  for (let si = 0; si < sections.length; si++) {
    const sec = sections[si];
    for (let px = 0; px < sec.width; px++) {
      const isDivider =
        si > 0 && px < DIVIDER_WIDTH; // セクション先頭の区切り線
      const color = isDivider ? DIVIDER : sec;
      rowPixels[x * 3]     = color.r;
      rowPixels[x * 3 + 1] = color.g;
      rowPixels[x * 3 + 2] = color.b;
      x++;
    }
  }

  // RAW スキャンライン（filter byte 0x00 + ピクセル）を height 行分
  const filterByte = Buffer.from([0x00]);
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(filterByte, rowPixels);
  }
  const rawData = Buffer.concat(rawRows);

  // IDAT: zlib deflate 圧縮
  const compressed = zlib.deflateSync(rawData, { level: 9 });

  // PNG 構造
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk('IHDR', Buffer.concat([
    u32(totalWidth),
    u32(height),
    Buffer.from([8, 2, 0, 0, 0]), // 8bit, RGB, no interlace
  ]));
  const idat = chunk('IDAT', compressed);
  const iend = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

// ─── リッチメニュー用 PNG プリセット ─────────────────────────

const AREA_W = 625;
const HEIGHT  = 843;

/** 全コマンド表示（デフォルト） */
function generateDefaultMenuImage() {
  return generateRichMenuPNG([
    { r: 220, g: 245, b: 220, width: AREA_W }, // 振込みました: 緑
    { r: 220, g: 235, b: 255, width: AREA_W }, // 受け取りました: 青
    { r: 255, g: 248, b: 220, width: AREA_W }, // 状況: 黄
    { r: 245, g: 220, b: 255, width: AREA_W }, // 履歴: 紫
  ], HEIGHT);
}

/** 受取人用（受け取りました強調） */
function generateReceiverMenuImage() {
  return generateRichMenuPNG([
    { r: 230, g: 230, b: 230, width: AREA_W }, // 振込みました: グレー
    { r: 130, g: 190, b: 255, width: AREA_W }, // 受け取りました: 青強調
    { r: 255, g: 248, b: 220, width: AREA_W }, // 状況
    { r: 245, g: 220, b: 255, width: AREA_W }, // 履歴
  ], HEIGHT);
}

/** 義務者用（振込みました強調） */
function generatePayerMenuImage() {
  return generateRichMenuPNG([
    { r: 130, g: 220, b: 130, width: AREA_W }, // 振込みました: 緑強調
    { r: 230, g: 230, b: 230, width: AREA_W }, // 受け取りました: グレー
    { r: 255, g: 248, b: 220, width: AREA_W }, // 状況
    { r: 245, g: 220, b: 255, width: AREA_W }, // 履歴
  ], HEIGHT);
}

module.exports = { generateDefaultMenuImage, generateReceiverMenuImage, generatePayerMenuImage };
