"use strict";

const $ = id => document.getElementById(id);
const ui = {
  fileInput: $("file-input"), dropZone: $("drop-zone"), fileMeta: $("file-meta"),
  encoding: $("encoding"), delimiter: $("delimiter"), analyze: $("analyze-btn"),
  error: $("error"), results: $("results"), summary: $("summary"),
  checks: $("checks"), preview: $("preview"), status: $("status-pill"),
  exportSummary: $("export-summary"), download: $("download-btn"),
  outputEncoding: $("output-encoding"), outputFormat: $("output-format"),
  columnSelection: $("column-selection"),
  dedupeMode: $("dedupe-mode"), dedupeColumns: $("dedupe-columns"),
  dedupeKeep: $("dedupe-keep"), dedupeOptions: $("dedupe-options"),
  dedupeColumnField: $("dedupe-column-field"), dedupePreview: $("dedupe-preview"),
  trim: $("trim-cells"), duplicates: $("remove-duplicates"), emptyRows: $("remove-empty-rows"),
  emptyColumns: $("remove-empty-columns"), headers: $("fix-headers"),
  padShort: $("pad-short-rows"), safeFormulas: $("safe-formulas")
};
$("year").textContent = new Date().getFullYear();
const MAX_FILE_SIZE = 20 * 1024 * 1024;
let selectedFile = null;
let activeData = null;
let taskNumber = 0;

ui.fileInput.addEventListener("change", () => setFile(ui.fileInput.files[0]));
ui.dropZone.addEventListener("dragover", event => { event.preventDefault(); ui.dropZone.classList.add("dragging"); });
ui.dropZone.addEventListener("dragleave", () => ui.dropZone.classList.remove("dragging"));
ui.dropZone.addEventListener("drop", event => {
  event.preventDefault(); ui.dropZone.classList.remove("dragging");
  if (event.dataTransfer.files[0]) setFile(event.dataTransfer.files[0]);
});
ui.analyze.addEventListener("click", analyzeFile);
ui.download.addEventListener("click", downloadCsv);
[ui.outputEncoding, ui.outputFormat, ui.trim, ui.duplicates, ui.emptyRows, ui.emptyColumns, ui.headers, ui.padShort, ui.safeFormulas, ui.dedupeMode, ui.dedupeKeep].forEach(el => el.addEventListener("change", updateExportSummary));
ui.columnSelection.addEventListener("input", updateExportSummary);
ui.dedupeColumns.addEventListener("input", updateExportSummary);
function updateDedupeControls() {
  ui.dedupeOptions.classList.toggle("is-inactive", !ui.duplicates.checked);
  ui.dedupeColumnField.classList.toggle("hidden", ui.dedupeMode.value !== "columns");
  ui.dedupeColumns.disabled = !ui.duplicates.checked || ui.dedupeMode.value !== "columns";
  ui.dedupeMode.disabled = !ui.duplicates.checked;
  ui.dedupeKeep.disabled = !ui.duplicates.checked;
  ui.dedupePreview.textContent = !ui.duplicates.checked ? "重複削除はオフです。元のデータ行を残します。" : "";
}
updateDedupeControls();

function setFile(file) {
  taskNumber += 1;
  ui.error.textContent = "";
  ui.results.classList.add("hidden");
  activeData = null;
  selectedFile = null;
  ui.analyze.disabled = true;
  if (!file) { ui.fileMeta.textContent = "ファイルはまだ選択されていません。"; return; }
  if (file.size > MAX_FILE_SIZE) {
    ui.fileMeta.textContent = `${file.name}（${formatBytes(file.size)}）`;
    showError("20MB以下のCSVまたはTSVを選択してください。");
    return;
  }
  if (file.size === 0) { showError("空のファイルです。別のファイルを選択してください。"); return; }
  selectedFile = file;
  ui.fileMeta.textContent = `${file.name} ・ ${formatBytes(file.size)}`;
  ui.analyze.disabled = false;
  if (/\.tsv$/i.test(file.name)) ui.delimiter.value = "tab";
}

async function analyzeFile() {
  if (!selectedFile) return;
  const myTask = ++taskNumber;
  const file = selectedFile;
  ui.analyze.disabled = true;
  ui.analyze.textContent = "診断中…";
  ui.error.textContent = "";
  ui.results.classList.add("hidden");
  activeData = null;
  // 描画のタイミングを譲り、処理中のボタンを表示する。
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (myTask !== taskNumber) return;
    const { text, encoding, inferred } = decodeCsv(bytes, ui.encoding.value);
    const delimiter = ui.delimiter.value === "auto" ? detectDelimiter(text) : (ui.delimiter.value === "tab" ? "\t" : ui.delimiter.value);
    const { rows, lineNumbers } = parseDelimited(text, delimiter);
    if (rows.length === 0 || rows.every(row => row.every(value => value.trim() === ""))) {
      throw new Error("読み取れるデータがありません。区切り文字や文字コードを確認してください。");
    }
    const report = diagnose(rows, lineNumbers);
    if (myTask !== taskNumber) return;
    activeData = { file, report, encoding, inferred, delimiter };
    ui.columnSelection.value = "";
    ui.dedupeColumns.value = "";
    ui.dedupeMode.value = "all";
    ui.dedupeKeep.value = "first";
    ui.duplicates.checked = false;
    renderReport(report, encoding, inferred, delimiter);
    updateExportSummary();
    ui.results.classList.remove("hidden");
    ui.results.scrollIntoView({ block: "start", behavior: "smooth" });
  } catch (error) {
    if (myTask === taskNumber) showError(`診断できませんでした：${error.message || "ファイルの形式を確認してください。"}`);
  } finally {
    if (myTask === taskNumber) { ui.analyze.disabled = false; ui.analyze.textContent = "CSVを診断する"; }
  }
}

function decodeCsv(bytes, chosen) {
  let encoding = chosen;
  let inferred = false;
  if (chosen === "auto") {
    inferred = true;
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      encoding = "utf-8";
    } else {
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); encoding = "utf-8"; }
      catch { encoding = "shift_jis"; }
    }
  }
  // 不正なバイト列を黙って置換するとデータを壊すため、エラーとして通知する。
  let text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error("指定した文字コードでは正しく読み取れません。文字コードを切り替えて再診断してください。"); }
  return { text: text.replace(/^\uFEFF/, ""), encoding, inferred };
}

// カンマ・タブ・セミコロンを推定。引用符の内側の区切り文字は数えない。
// 判定できないときは一般的なカンマ区切りを既定値にする。必ずプレビューで確認すること。
function detectDelimiter(text) {
  const candidates = [",", "\t", ";"];
  const totals = candidates.map(() => []);
  let inQuotes = false, atCellStart = true, counts = [0, 0, 0], completed = 0;
  for (let i = 0; i < text.length && i < 150000 && completed < 30; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { i++; continue; }
      if (inQuotes) { inQuotes = false; continue; }
      if (atCellStart) { inQuotes = true; continue; }
    }
    if (inQuotes) continue;
    if (c === "\r" || c === "\n") {
      totals.forEach((arr, n) => arr.push(counts[n]));
      counts = [0, 0, 0]; atCellStart = true; completed++;
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      const n = candidates.indexOf(c);
      if (n >= 0) { counts[n]++; atCellStart = true; }
      else if (c !== " " && c !== "\t") atCellStart = false;
    }
  }
  if (counts.some(n => n > 0)) totals.forEach((arr, n) => arr.push(counts[n]));
  let winner = 0, best = -1;
  totals.forEach((arr, n) => {
    const positive = arr.filter(v => v > 0);
    if (!positive.length) return;
    const frequencies = new Map();
    positive.forEach(v => frequencies.set(v, (frequencies.get(v) || 0) + 1));
    const mostFrequent = Math.max(...frequencies.values());
    // 多くの行で安定して現れる区切り文字を優先する。
    const score = mostFrequent * 10000 + positive.length * 100 + positive.reduce((a, b) => a + b, 0);
    if (score > best) { best = score; winner = n; }
  });
  return candidates[winner];
}

// RFC 4180系の引用符・セル内改行を扱い、元の物理行番号を保持する。
function parseDelimited(text, separator = ",") {
  const rows = [], lineNumbers = [];
  let row = [], field = "", state = "start", line = 1, rowStart = 1;
  let atRowStart = true;
  const emitField = () => { row.push(field); field = ""; state = "start"; atRowStart = false; };
  const emitRow = () => { emitField(); rows.push(row); lineNumbers.push(rowStart); row = []; atRowStart = true; rowStart = line + 1; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const newline = ch === "\n" || ch === "\r";
    if (state === "quoted") {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = "afterQuote";
      } else if (newline) {
        field += "\n";
        if (ch === "\r" && text[i + 1] === "\n") i++;
        line++;
      } else field += ch;
      continue;
    }
    if (ch === separator) { emitField(); continue; }
    if (newline) {
      emitRow();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      rowStart = line;
      continue;
    }
    if (state === "afterQuote") {
      if (ch === " " || ch === "\t") continue; // 一部のCSV出力ツールの引用符後空白を許容する
      throw new Error(`${line}行目に、閉じた引用符の後の不正な文字があります。`);
    }
    if (state === "start" && ch === '"') { state = "quoted"; continue; }
    // unquotedで途中に現れる二重引用符は文字として読み込む。
    field += ch;
    state = "plain";
  }
  if (state === "quoted") throw new Error(`${rowStart}行目から始まるセルのダブルクォートが閉じていません。`);
  // 末尾の改行による架空の空行は追加しない。実在する空行は保持。
  if (row.length > 0 || field.length > 0 || state === "afterQuote" || state === "plain") {
    emitField(); rows.push(row); lineNumbers.push(rowStart);
  }
  return { rows, lineNumbers };
}

function diagnose(rows, lineNumbers) {
  const header = rows[0];
  const dataRows = rows.slice(1);
  const expected = header.length;
  const mismatches = [];
  dataRows.forEach((row, index) => { if (row.length !== expected) mismatches.push({ line: lineNumbers[index + 1], columns: row.length }); });
  const blankHeaders = [], duplicateHeaders = [], seenHeaders = new Set();
  header.forEach((head, index) => {
    const h = head.trim();
    if (!h) blankHeaders.push(index + 1);
    const key = h.toLocaleLowerCase();
    if (key && seenHeaders.has(key)) duplicateHeaders.push(`${h}（${index + 1}列目）`);
    if (key) seenHeaders.add(key);
  });
  const seenRows = new Set();
  let duplicateCount = 0, emptyCount = 0;
  dataRows.forEach(row => {
    if (row.every(value => value.trim() === "")) emptyCount++;
    const key = JSON.stringify(row);
    if (seenRows.has(key)) duplicateCount++;
    seenRows.add(key);
  });
  const blankColumnIndexes = [];
  for (let col = 0; col < expected; col++) {
    if (dataRows.length > 0 && dataRows.every(row => (row[col] || "").trim() === "")) blankColumnIndexes.push(col);
  }
  return { rows, header, dataRows, expected, mismatches, blankHeaders, duplicateHeaders, duplicateCount, emptyCount, blankColumnIndexes };
}

function renderReport(report, encoding, inferred, delimiter) {
  ui.summary.replaceChildren();
  [["全行数（見出し含む）", report.rows.length], ["見出しの列数", report.expected], ["列数が異なる行", report.mismatches.length], ["重複行", report.duplicateCount]].forEach(([label, value]) => {
    const card = document.createElement("div"); card.className = "summary-card";
    const title = document.createElement("span"); title.textContent = label;
    const number = document.createElement("strong"); number.textContent = value.toLocaleString("ja-JP");
    card.append(title, number); ui.summary.append(card);
  });
  ui.checks.replaceChildren();
  const pairs = [
    report.mismatches.length ? ["warn", "列数の不一致：" + report.mismatches.length + "行", "見出しは" + report.expected + "列。対象の物理行番号：" + report.mismatches.slice(0, 12).map(x => `${x.line}行（${x.columns}列）`).join("、") + (report.mismatches.length > 12 ? " など" : "")] : ["ok", "列数の不一致なし", "データ行の列数が見出しと一致しています。"],
    report.blankHeaders.length ? ["warn", "空の見出し：" + report.blankHeaders.length + "列", "対象列：" + report.blankHeaders.join("、")] : ["ok", "空の見出しなし", "見出し行に空欄は見つかりませんでした。"],
    report.duplicateHeaders.length ? ["warn", "重複した見出し：" + report.duplicateHeaders.length + "件", report.duplicateHeaders.slice(0, 12).join("、")] : ["ok", "重複した見出しなし", "同じ見出し名は見つかりませんでした。"],
    report.duplicateCount ? ["warn", "重複行：" + report.duplicateCount + "件", "同じ値・同じ列数のデータ行が複数あります。任意で削除できます。"] : ["ok", "重複行なし", "完全一致するデータ行は見つかりませんでした。"],
    report.emptyCount ? ["warn", "空白だけの行：" + report.emptyCount + "行", "任意で削除できます。"] : ["ok", "空白だけの行なし", "空白だけのデータ行は見つかりませんでした。"],
    report.blankColumnIndexes.length ? ["warn", "全データ行で空の列：" + report.blankColumnIndexes.length + "列", "対象列：" + report.blankColumnIndexes.map(x => x + 1).join("、") + "。任意で削除できます。"] : ["ok", "全データ行で空の列なし", "データ行がある列では空でない値が確認できました。"],
    ["info", "読み込み文字コード：" + (encoding === "shift_jis" ? "Shift_JIS系" : "UTF-8") + (inferred ? "（自動判定）" : "（指定）"), "自動判定は推定です。必ずプレビューで日本語を確認してください。"],
    ["info", "区切り文字：" + (delimiter === "\t" ? "タブ（TSV）" : delimiter === ";" ? "セミコロン" : "カンマ") + (ui.delimiter.value === "auto" ? "（自動判定）" : "（指定）"), "列の表示が不自然な場合は、読み込み時の区切り文字を切り替えて再診断してください。"]
  ];
  pairs.forEach(([kind, title, detail]) => {
    const item = document.createElement("div"); item.className = `check-item ${kind}`;
    const icon = document.createElement("span"); icon.className = "check-icon"; icon.textContent = kind === "ok" ? "✓" : kind === "warn" ? "!" : "i";
    const box = document.createElement("div");
    const strong = document.createElement("strong"); strong.textContent = title;
    const body = document.createElement("div"); body.textContent = detail;
    box.append(strong, body); item.append(icon, box); ui.checks.append(item);
  });
  ui.status.textContent = report.mismatches.length || report.blankHeaders.length || report.duplicateCount || report.emptyCount ? "要確認の項目あり" : "診断済み";
  ui.preview.replaceChildren();
  report.rows.slice(0, 11).forEach((row, index) => {
    const tr = document.createElement("tr");
    row.forEach(cell => { const td = document.createElement(index === 0 ? "th" : "td"); td.textContent = cell; tr.append(td); });
    ui.preview.append(tr);
  });
}

// 選択列の書式: 「1,3-5」など。空欄は全列を意味する。
function parseColumnSelection(input, width) {
  const raw = input.trim();
  if (!raw) return null;
  if (!/^[0-9,\-\s]+$/.test(raw)) throw new Error("列番号は半角数字・カンマ・ハイフンで入力してください（例：1,3-5）。");
  const picked = [];
  const seen = new Set();
  for (const chunk of raw.split(",")) {
    const part = chunk.trim();
    const match = part.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error("列番号の指定が正しくありません（例：1,3-5）。");
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to > width) {
      throw new Error(`列番号は1〜${width}の範囲で、小さい順に範囲指定してください。`);
    }
    // 同じ列を繰り返し指定した場合は、一度だけ出力。
    for (let n = from; n <= to; n++) if (!seen.has(n)) { seen.add(n); picked.push(n - 1); }
  }
  if (!picked.length) throw new Error("出力する列を1つ以上指定してください。");
  return picked;
}

// 見出しから左に1列目、2列目…と数える。抽出した場合は指定列だけを出力する。
// 指定列がすべて空欄の場合は、キーの欠落による誤削除を防ぐため必ず残す。
// 通常の行全体一致は、列数が異なる行を別物として扱う。
function deduplicateRows(dataRows, mode = "all", keyIndexes = null, keep = "first") {
  if (mode !== "all" && mode !== "columns") throw new Error("重複の判定方法を選び直してください。");
  if (keep !== "first" && keep !== "last") throw new Error("残す行の指定を確認してください。");
  if (mode === "columns" && (!Array.isArray(keyIndexes) || !keyIndexes.length)) {
    throw new Error("重複判定に使う列番号を1つ以上入力してください（例：3 または 1,3）。");
  }
  const seen = new Set();
  const keepFlags = Array(dataRows.length).fill(false);
  const indexes = [...Array(dataRows.length).keys()];
  if (keep === "last") indexes.reverse();
  let duplicateRemoved = 0, blankKeysPreserved = 0;
  for (const i of indexes) {
    const row = dataRows[i];
    const cells = mode === "columns" ? keyIndexes.map(index => row[index] ?? "") : row;
    if (mode === "columns" && cells.every(cell => String(cell).trim() === "")) {
      keepFlags[i] = true;
      blankKeysPreserved++;
      continue;
    }
    const key = JSON.stringify(cells);
    if (seen.has(key)) { duplicateRemoved++; continue; }
    seen.add(key);
    keepFlags[i] = true;
  }
  return {
    rows: dataRows.filter((row, i) => keepFlags[i]),
    duplicateRemoved,
    blankKeysPreserved
  };
}

// 出力列抽出より前に重複を判定するため、元の列番号がそのまま使える。
function buildOutputRows(report, selectionText = ui.columnSelection.value) {
  const opts = { trim: ui.trim.checked, duplicates: ui.duplicates.checked, emptyRows: ui.emptyRows.checked, emptyColumns: ui.emptyColumns.checked, headers: ui.headers.checked, padShort: ui.padShort.checked, safeFormulas: ui.safeFormulas.checked };
  const originalWidth = report.expected;
  const selected = parseColumnSelection(selectionText, originalWidth);
  let keyIndexes = null;
  if (opts.duplicates && ui.dedupeMode.value === "columns") {
    keyIndexes = parseColumnSelection(ui.dedupeColumns.value, originalWidth);
    if (!keyIndexes) throw new Error("重複判定に使う列番号を1つ以上入力してください（例：3 または 1,3）。");
  }
  let rows = report.rows.map(row => row.map(cell => opts.trim ? cell.trim() : cell));
  const before = rows.length;
  const dataBefore = rows.length - 1;
  if (opts.emptyRows) rows = [rows[0], ...rows.slice(1).filter(row => !row.every(cell => cell.trim() === ""))];
  const emptyRowsRemoved = dataBefore - (rows.length - 1);
  let duplicateRemoved = 0, blankKeysPreserved = 0;
  if (opts.duplicates) {
    const result = deduplicateRows(rows.slice(1), ui.dedupeMode.value, keyIndexes, ui.dedupeKeep.value);
    rows = [rows[0], ...result.rows];
    duplicateRemoved = result.duplicateRemoved;
    blankKeysPreserved = result.blankKeysPreserved;
  }
  if (opts.padShort) rows = rows.map(row => row.length >= originalWidth ? row : [...row, ...Array(originalWidth - row.length).fill("")]);
  if (selected) rows = rows.map(row => selected.map(index => row[index] ?? ""));
  const width = rows[0].length;
  if (opts.emptyColumns) {
    const indexes = [...Array(width).keys()].filter(index => rows.slice(1).length > 0 && rows.slice(1).every(row => (row[index] || "").trim() === ""));
    const blocked = new Set(indexes);
    if (indexes.length < width) rows = rows.map(row => row.filter((_, index) => !blocked.has(index)));
  }
  if (opts.headers) {
    const used = new Set();
    rows[0] = rows[0].map((cell, i) => {
      const base = cell.trim() || `列${i + 1}`;
      let candidate = base, n = 2;
      while (used.has(candidate.toLocaleLowerCase())) candidate = `${base}_${n++}`;
      used.add(candidate.toLocaleLowerCase());
      return candidate;
    });
  }
  if (opts.safeFormulas) rows = rows.map(row => row.map(cell => shouldProtectFormula(cell) ? "'" + cell : cell));
  return { rows, removedRows: before - rows.length, removedColumns: originalWidth - rows[0].length, duplicateRemoved, blankKeysPreserved, emptyRowsRemoved };
}
function shouldProtectFormula(cell) {
  if (!/^[\s\u0000-\u001f]*[=+@-]/.test(cell)) return false;
  // 負数・正数は通常の数値として保持する。
  if (/^[+-](?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(cell.trim())) return false;
  return true;
}
function updateExportSummary() {
  updateDedupeControls();
  if (!activeData) { ui.exportSummary.textContent = ""; ui.download.disabled = true; return; }
  try {
    const { rows, removedRows, removedColumns, duplicateRemoved, blankKeysPreserved } = buildOutputRows(activeData.report);
    ui.exportSummary.textContent = `出力予定：${rows.length}行 × 見出し${rows[0].length}列 ｜ 削除される行：${removedRows}（重複：${duplicateRemoved}） ｜ 出力しない列：${removedColumns} ｜ 形式：${ui.outputFormat.value.toUpperCase()}`;
    ui.exportSummary.classList.remove("invalid");
    if (ui.duplicates.checked) {
      ui.dedupePreview.textContent = `重複として削除予定：${duplicateRemoved}行` + (ui.dedupeMode.value === "columns" ? ` ｜ 判定列がすべて空欄で残す行：${blankKeysPreserved}行` : "") + "。出力ファイルで必ず内容を確認してください。";
    }
    ui.download.disabled = false;
  } catch (error) {
    ui.exportSummary.textContent = `入力を確認してください：${error.message}`;
    ui.exportSummary.classList.add("invalid");
    ui.dedupePreview.textContent = ui.duplicates.checked ? error.message : "";
    ui.download.disabled = true;
  }
}
function downloadCsv() {
  if (!activeData || ui.download.disabled) return;
  let rows;
  try { ({ rows } = buildOutputRows(activeData.report)); }
  catch (error) { showError(error.message); return; }
  const sep = ui.outputFormat.value === "tsv" ? "\t" : ",";
  const lines = rows.map(row => row.map(cell => escapeDelimitedCell(cell, sep)).join(sep)).join("\r\n");
  const bom = ui.outputEncoding.value === "utf-8-bom" ? "\uFEFF" : "";
  const type = ui.outputFormat.value === "tsv" ? "text/tab-separated-values;charset=utf-8" : "text/csv;charset=utf-8";
  const blob = new Blob([bom, lines], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const baseName = (activeData.file.name || "data.csv").replace(/\.[^.]+$/, "");
  a.download = `${baseName}_整理済み.${ui.outputFormat.value}`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function escapeDelimitedCell(value, separator) {
  const s = String(value ?? "");
  return s.includes(separator) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function escapeCsvCell(value) { return escapeDelimitedCell(value, ","); }
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function showError(message) { ui.error.textContent = message; }

// ブラウザ・Nodeでテストしやすいようにロジックだけを公開する（画面からの動作には影響しない）。
if (typeof module !== "undefined" && module.exports) module.exports = { parseDelimited, diagnose, decodeCsv, detectDelimiter, parseColumnSelection, escapeCsvCell, escapeDelimitedCell, shouldProtectFormula, deduplicateRows, buildOutputRows };
