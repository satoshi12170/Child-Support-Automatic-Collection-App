'use strict';

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

// ─── フォント登録 ─────────────────────────────────────────────
// @fontsource/noto-sans-jp の日本語サブセット woff2 を読み込む。
// システムフォントに依存しないため Railway 等のクラウド環境でも確実に動作する。

const FONTS_DIR = path.join(
  __dirname, '../../node_modules/@fontsource/noto-sans-jp/files'
);

for (const file of [
  'noto-sans-jp-japanese-400-normal.woff2',
  'noto-sans-jp-japanese-700-normal.woff2',
]) {
  const full = path.join(FONTS_DIR, file);
  if (fs.existsSync(full)) {
    GlobalFonts.register(fs.readFileSync(full), 'Noto Sans JP');
  }
}

// ─── レイアウト定数 ───────────────────────────────────────────

const WIDTH       = 2500;
const HEIGHT      = 843;
const AREA_W      = 625;
const FONT_SIZE   = 56;
const LINE_HEIGHT = 78;
const FONT_SPEC   = `bold ${FONT_SIZE}px "Noto Sans JP", sans-serif`;
const DIVIDER_CLR = 'rgb(180,180,180)';

// ─── 描画ヘルパー ─────────────────────────────────────────────

function renderSection(ctx, sec, x) {
  // 背景
  ctx.fillStyle = `rgb(${sec.r},${sec.g},${sec.b})`;
  ctx.fillRect(x, 0, sec.width, HEIGHT);

  // テキスト（複数行）
  if (sec.lines && sec.lines.length) {
    ctx.save();
    ctx.fillStyle    = sec.textColor || '#333333';
    ctx.font         = FONT_SPEC;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    const totalH = sec.lines.length * LINE_HEIGHT;
    const startY = (HEIGHT - totalH) / 2 + LINE_HEIGHT / 2;
    const cx     = x + sec.width / 2;

    sec.lines.forEach((line, i) => {
      ctx.fillText(line, cx, startY + i * LINE_HEIGHT);
    });
    ctx.restore();
  }
}

function generateRichMenuPNG(sections) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx    = canvas.getContext('2d');

  let x = 0;
  sections.forEach((sec, i) => {
    renderSection(ctx, sec, x);
    if (i > 0) {
      ctx.fillStyle = DIVIDER_CLR;
      ctx.fillRect(x, 0, 2, HEIGHT);
    }
    x += sec.width;
  });

  return canvas.toBuffer('image/png');
}

// ─── リッチメニュー用プリセット ───────────────────────────────

/** デフォルト：全ボタン通常表示 */
function generateDefaultMenuImage() {
  return generateRichMenuPNG([
    { r: 220, g: 245, b: 220, width: AREA_W, lines: ['振込み', 'ました'] },
    { r: 220, g: 235, b: 255, width: AREA_W, lines: ['受け取り', 'ました'] },
    { r: 255, g: 248, b: 220, width: AREA_W, lines: ['状況'] },
    { r: 245, g: 220, b: 255, width: AREA_W, lines: ['履歴'] },
  ]);
}

/** 受取人用：「受け取りました」を強調、「振込みました」はグレーアウト */
function generateReceiverMenuImage() {
  return generateRichMenuPNG([
    { r: 230, g: 230, b: 230, width: AREA_W, lines: ['振込み', 'ました'], textColor: '#aaaaaa' },
    { r: 130, g: 190, b: 255, width: AREA_W, lines: ['受け取り', 'ました'], textColor: '#1a1a6e' },
    { r: 255, g: 248, b: 220, width: AREA_W, lines: ['状況'] },
    { r: 245, g: 220, b: 255, width: AREA_W, lines: ['履歴'] },
  ]);
}

/** 義務者用：「振込みました」を強調、「受け取りました」はグレーアウト */
function generatePayerMenuImage() {
  return generateRichMenuPNG([
    { r: 130, g: 220, b: 130, width: AREA_W, lines: ['振込み', 'ました'], textColor: '#0a3d0a' },
    { r: 230, g: 230, b: 230, width: AREA_W, lines: ['受け取り', 'ました'], textColor: '#aaaaaa' },
    { r: 255, g: 248, b: 220, width: AREA_W, lines: ['状況'] },
    { r: 245, g: 220, b: 255, width: AREA_W, lines: ['履歴'] },
  ]);
}

module.exports = { generateDefaultMenuImage, generateReceiverMenuImage, generatePayerMenuImage };
