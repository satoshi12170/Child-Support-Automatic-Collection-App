'use strict';

/**
 * テストケース一覧とテスト結果をExcelファイルに出力するスクリプト
 * 使い方: node scripts/generate-test-report.js
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// ─── テスト結果JSONを読み込み ─────────────────────────────────

const jestResultPath = path.resolve(__dirname, '../tmp/jest-results.json');
if (!fs.existsSync(jestResultPath)) {
  console.error('テスト結果JSONが見つかりません。先に以下を実行してください:');
  console.error('  npx jest --forceExit --detectOpenHandles --json > tmp/jest-results.json');
  process.exit(1);
}

const jestResult = JSON.parse(fs.readFileSync(jestResultPath, 'utf8'));

// ─── カテゴリ定義 ─────────────────────────────────────────────

const CATEGORIES = {
  'A': { name: 'オンボーディング正常系', doc: '詳細設計 §2, 基本設計 §4' },
  'B': { name: 'オンボーディング境界値・異常系', doc: '詳細設計 §2, 基本設計 §4' },
  'C': { name: '支払い管理コマンド', doc: '詳細設計 §3, 基本設計 §5' },
  'D': { name: '状態遷移', doc: '基本設計 §5 状態遷移図' },
  'E': { name: '通知スケジュール（Cron）', doc: '詳細設計 §4, 基本設計 §6' },
  'F': { name: 'エラーハンドリング', doc: '詳細設計 §5, §6' },
  'G': { name: 'セキュリティ', doc: '非機能要件 §3' },
  'H': { name: 'APIエンドポイント', doc: '基本設計 §1' },
  'I': { name: '非機能要件', doc: '非機能要件 §1〜§7' },
  'J': { name: 'E2E（エンドツーエンド）シナリオ', doc: '全設計ドキュメント横断' },
};

// ─── テスト結果を整理 ─────────────────────────────────────────

function extractTests(jestResult) {
  const tests = [];
  let seq = 0;

  for (const suite of jestResult.testResults) {
    const fileName = path.basename(suite.name);

    for (const test of suite.assertionResults) {
      seq++;
      const fullName = test.ancestorTitles.join(' > ') + ' > ' + test.title;

      // カテゴリIDを推定
      let categoryId = '';
      const catMatch = fullName.match(/^([A-J])[-:\s]|^([A-J])\d/);
      if (catMatch) {
        categoryId = catMatch[1] || catMatch[2];
      } else {
        // ファイル名からカテゴリを推定
        if (fileName.includes('a-onboarding-normal')) categoryId = 'A';
        else if (fileName.includes('b-onboarding-boundary')) categoryId = 'B';
        else if (fileName.includes('c-payment')) categoryId = 'C';
        else if (fileName.includes('d-state')) categoryId = 'D';
        else if (fileName.includes('e-notification')) categoryId = 'E';
        else if (fileName.includes('fg-errors')) {
          categoryId = fullName.includes('G:') || fullName.includes('G-') ? 'G' : 'F';
        }
        else if (fileName.includes('hi-api')) {
          categoryId = fullName.includes('I:') || fullName.includes('I-') ? 'I' : 'H';
        }
        else if (fileName.includes('j-e2e')) categoryId = 'J';
      }

      // テストID推定
      let testId = '';
      const idMatch = fullName.match(/([A-J]-?\d[\d-]*\d*)/);
      if (idMatch) {
        testId = idMatch[1];
      }

      // describe名とテスト名を分離
      const describeName = test.ancestorTitles.join(' > ');
      const testTitle = test.title;

      tests.push({
        seq,
        categoryId,
        categoryName: CATEGORIES[categoryId]?.name || '',
        docRef: CATEGORIES[categoryId]?.doc || '',
        testId,
        describeName,
        testTitle,
        fullName,
        status: test.status, // 'passed', 'failed', 'pending'
        duration: test.duration || 0,
        fileName,
        failureMessages: test.failureMessages?.join('\n') || '',
      });
    }
  }

  return tests;
}

// ─── Excel生成 ─────────────────────────────────────────────────

async function generateExcel(tests, jestResult) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'テスト自動生成スクリプト';
  workbook.created = new Date();

  // ━━━ Sheet 1: サマリー ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const summarySheet = workbook.addWorksheet('テスト結果サマリー', {
    properties: { tabColor: { argb: '4472C4' } },
  });

  // ヘッダースタイル
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
  const headerFont = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
  const borderStyle = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };

  // 全体概要セクション
  summarySheet.mergeCells('A1:F1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = 'ブラックボックステスト結果レポート';
  titleCell.font = { bold: true, size: 16, color: { argb: '1F4E79' } };
  titleCell.alignment = { horizontal: 'center' };

  summarySheet.mergeCells('A2:F2');
  const subtitleCell = summarySheet.getCell('A2');
  subtitleCell.value = '養育費自動集金LINE Botアプリケーション';
  subtitleCell.font = { size: 12, color: { argb: '404040' } };
  subtitleCell.alignment = { horizontal: 'center' };

  // 実行情報
  const runDate = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const infoStart = 4;
  const infoData = [
    ['実行日時', runDate],
    ['テスト総数', jestResult.numTotalTests],
    ['合格', jestResult.numPassedTests],
    ['不合格', jestResult.numFailedTests],
    ['合格率', `${((jestResult.numPassedTests / jestResult.numTotalTests) * 100).toFixed(1)}%`],
    ['実行時間', `${(jestResult.testResults.reduce((sum, s) => sum + (s.endTime - s.startTime), 0) / 1000).toFixed(2)}秒`],
    ['テストスイート数', jestResult.numTotalTestSuites],
  ];

  infoData.forEach(([label, value], i) => {
    const row = infoStart + i;
    summarySheet.getCell(`A${row}`).value = label;
    summarySheet.getCell(`A${row}`).font = { bold: true };
    summarySheet.getCell(`B${row}`).value = value;
    if (label === '合格率') {
      const rate = jestResult.numPassedTests / jestResult.numTotalTests;
      summarySheet.getCell(`B${row}`).font = {
        bold: true,
        color: { argb: rate === 1 ? '00B050' : rate >= 0.9 ? 'FFC000' : 'FF0000' },
        size: 14,
      };
    }
  });

  // カテゴリ別集計テーブル
  const catTableStart = infoStart + infoData.length + 2;
  summarySheet.mergeCells(`A${catTableStart}:F${catTableStart}`);
  summarySheet.getCell(`A${catTableStart}`).value = 'カテゴリ別テスト結果';
  summarySheet.getCell(`A${catTableStart}`).font = { bold: true, size: 13 };

  const catHeaderRow = catTableStart + 1;
  const catHeaders = ['カテゴリ', 'カテゴリ名', '根拠ドキュメント', '合格', '不合格', '合格率'];
  catHeaders.forEach((h, i) => {
    const cell = summarySheet.getCell(catHeaderRow, i + 1);
    cell.value = h;
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.border = borderStyle;
    cell.alignment = { horizontal: 'center' };
  });

  const catSummary = {};
  tests.forEach(t => {
    if (!catSummary[t.categoryId]) {
      catSummary[t.categoryId] = { passed: 0, failed: 0 };
    }
    if (t.status === 'passed') catSummary[t.categoryId].passed++;
    else catSummary[t.categoryId].failed++;
  });

  let catRow = catHeaderRow + 1;
  Object.keys(CATEGORIES).forEach(catId => {
    const cat = CATEGORIES[catId];
    const stats = catSummary[catId] || { passed: 0, failed: 0 };
    const total = stats.passed + stats.failed;
    const rate = total > 0 ? (stats.passed / total * 100).toFixed(1) + '%' : '-';

    const rowData = [catId, cat.name, cat.doc, stats.passed, stats.failed, rate];
    rowData.forEach((val, i) => {
      const cell = summarySheet.getCell(catRow, i + 1);
      cell.value = val;
      cell.border = borderStyle;
      cell.alignment = { horizontal: i >= 3 ? 'center' : 'left' };
    });

    // 合格率セルの色
    const rateCell = summarySheet.getCell(catRow, 6);
    if (stats.failed === 0 && total > 0) {
      rateCell.font = { bold: true, color: { argb: '00B050' } };
    } else if (stats.failed > 0) {
      rateCell.font = { bold: true, color: { argb: 'FF0000' } };
    }

    catRow++;
  });

  // 合計行
  const totalPassed = tests.filter(t => t.status === 'passed').length;
  const totalFailed = tests.filter(t => t.status !== 'passed').length;
  const totalRate = ((totalPassed / tests.length) * 100).toFixed(1) + '%';
  const totalData = ['合計', '', '', totalPassed, totalFailed, totalRate];
  totalData.forEach((val, i) => {
    const cell = summarySheet.getCell(catRow, i + 1);
    cell.value = val;
    cell.border = borderStyle;
    cell.font = { bold: true };
    cell.alignment = { horizontal: i >= 3 ? 'center' : 'left' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9E2F3' } };
  });

  // 列幅設定
  summarySheet.getColumn(1).width = 14;
  summarySheet.getColumn(2).width = 30;
  summarySheet.getColumn(3).width = 30;
  summarySheet.getColumn(4).width = 10;
  summarySheet.getColumn(5).width = 10;
  summarySheet.getColumn(6).width = 12;

  // ━━━ Sheet 2: テストケース詳細 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const detailSheet = workbook.addWorksheet('テストケース詳細', {
    properties: { tabColor: { argb: '00B050' } },
  });

  const detailHeaders = [
    'No.', 'カテゴリ', 'テストID', 'テストグループ', 'テスト項目名',
    '結果', '実行時間(ms)', 'テストファイル',
  ];

  const detailHeaderRow = detailSheet.addRow(detailHeaders);
  detailHeaderRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.border = borderStyle;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  detailSheet.getRow(1).height = 24;

  // フィルター設定
  detailSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: detailHeaders.length },
  };

  tests.forEach((t) => {
    const row = detailSheet.addRow([
      t.seq,
      t.categoryId,
      t.testId,
      t.describeName,
      t.testTitle,
      t.status === 'passed' ? '合格' : '不合格',
      t.duration,
      t.fileName,
    ]);

    row.eachCell((cell) => {
      cell.border = borderStyle;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });

    // 結果セルの色
    const statusCell = row.getCell(6);
    if (t.status === 'passed') {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C6EFCE' } };
      statusCell.font = { color: { argb: '006100' }, bold: true };
    } else {
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } };
      statusCell.font = { color: { argb: '9C0006' }, bold: true };
    }
    statusCell.alignment = { horizontal: 'center' };

    // 偶数行の背景色
    if (t.seq % 2 === 0) {
      row.eachCell((cell, colNumber) => {
        if (colNumber !== 6) { // 結果列はスキップ
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F2F2' } };
        }
      });
    }
  });

  // 列幅設定
  detailSheet.getColumn(1).width = 6;
  detailSheet.getColumn(2).width = 10;
  detailSheet.getColumn(3).width = 12;
  detailSheet.getColumn(4).width = 40;
  detailSheet.getColumn(5).width = 60;
  detailSheet.getColumn(6).width = 10;
  detailSheet.getColumn(7).width = 14;
  detailSheet.getColumn(8).width = 30;

  // ━━━ Sheet 3: テストケース仕様一覧 ━━━━━━━━━━━━━━━━━━━━━━━━━
  const specSheet = workbook.addWorksheet('テストケース仕様', {
    properties: { tabColor: { argb: 'FFC000' } },
  });

  const specHeaders = [
    'No.', 'カテゴリ', 'カテゴリ名', 'テストID', 'テストグループ',
    'テスト項目名', '根拠ドキュメント', 'テスト種別',
  ];

  const specHeaderRow = specSheet.addRow(specHeaders);
  specHeaderRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC000' } };
    cell.font = { bold: true, size: 11 };
    cell.border = borderStyle;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  specSheet.getRow(1).height = 24;

  specSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: specHeaders.length },
  };

  tests.forEach((t) => {
    // テスト種別を推定
    let testType = '機能テスト';
    if (t.categoryId === 'B') testType = '境界値テスト';
    else if (t.categoryId === 'D') testType = '状態遷移テスト';
    else if (t.categoryId === 'E') testType = 'スケジュールテスト';
    else if (t.categoryId === 'F') testType = 'エラーハンドリングテスト';
    else if (t.categoryId === 'G') testType = 'セキュリティテスト';
    else if (t.categoryId === 'I') testType = '非機能テスト';
    else if (t.categoryId === 'J') testType = 'E2Eテスト';

    const row = specSheet.addRow([
      t.seq,
      t.categoryId,
      t.categoryName,
      t.testId,
      t.describeName,
      t.testTitle,
      t.docRef,
      testType,
    ]);

    row.eachCell((cell) => {
      cell.border = borderStyle;
      cell.alignment = { vertical: 'middle', wrapText: true };
    });

    if (t.seq % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2CC' } };
      });
    }
  });

  specSheet.getColumn(1).width = 6;
  specSheet.getColumn(2).width = 10;
  specSheet.getColumn(3).width = 28;
  specSheet.getColumn(4).width = 12;
  specSheet.getColumn(5).width = 40;
  specSheet.getColumn(6).width = 60;
  specSheet.getColumn(7).width = 28;
  specSheet.getColumn(8).width = 20;

  // ━━━ 保存 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const outputPath = path.resolve(__dirname, '../test-report.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Excel出力完了: ${outputPath}`);
  console.log(`  テスト総数: ${tests.length}`);
  console.log(`  合格: ${totalPassed} / 不合格: ${totalFailed}`);
  console.log(`  合格率: ${totalRate}`);
}

// ─── メイン ───────────────────────────────────────────────────

const tests = extractTests(jestResult);
generateExcel(tests, jestResult).catch(err => {
  console.error('Excel生成エラー:', err);
  process.exit(1);
});
