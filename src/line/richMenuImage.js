'use strict';

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');

// システムフォントをロード（Nixpacksでインストールされた日本語フォントを含む）
GlobalFonts.loadSystemFonts();

// Nix store 配下のフォントディレクトリを明示的にスキャン
// （fontconfigの自動検出で拾われない場合のフォールバック）
const NIX_FONT_ROOTS = [
  '/nix/var/nix/profiles/default/share/fonts',
  '/run/current-system/sw/share/fonts',
  '/usr/share/fonts',
  '/usr/local/share/fonts',
];
for (const dir of NIX_FONT_ROOTS) {
  if (fs.existsSync(dir)) {
    GlobalFonts.loadFontsFromDir(dir);
  }
}

// ─── レイアウト定数 ───────────────────────────────────────────

const WIDTH   = 2500;
const HEIGHT  = 843;
const AREA_W  = 625;
const FONT_SIZE  = 56;
const LINE_HEIGHT = 78;
const DIVIDER_COLOR = 'rgb(180,180,180)';

// ─── 描画 ─────────────────────────────────────────────────────

function renderSection(ctx, sec, x) {
  // 背景
  ctx.fillStyle = `rgb(${sec.r},${sec.g},${sec.b})`;
  ctx.fillRect(x, 0, sec.width, HEIGHT);

  // テキスト（複数行対応）
  if (sec.lines && sec.lines.length) {
    ctx.save();
    ctx.fillStyle    = sec.textColor || '#333333';
    ctx.font         = `bold ${FONT_SIZE}px "Noto Sans CJK JP", "Noto Sans JP", sans-serif`;
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
    // セクション間の区切り線
    if (i > 0) {
      ctx.fillStyle = DIVIDER_COLOR;
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
