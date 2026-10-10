const fileInput = document.getElementById("file-input");
const dropZone = document.getElementById("drop-zone");
const fileMeta = document.getElementById("file-meta");
const encodingSelect = document.getElementById("encoding");
const analyzeBtn = document.getElementById("analyze-btn");
const errorEl = document.getElementById("error");
const results = document.getElementById("results");
const summary = document.getElementById("summary");
const checks = document.getElementById("checks");
const preview = document.getElementById("preview");
const outputEncoding = document.getElementById("output-encoding");
const trimCells = document.getElementById("trim-cells");
const removeDuplicates = document.getElementById("remove-duplicates");
const downloadBtn = document.getElementById("download-btn");
document.getElementById("year").textContent = new Date().getFullYear();

let selectedFile = null;
let parsedRows = [];
let lastEncoding = "utf-8";
let lastReport = null;

fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragging"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragging");
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});
analyzeBtn.addEventListener("click", analyzeFile);
downloadBtn.addEventListener("click", downloadCsv);

function setFile(file) {
  errorEl.textContent = "";
  results.classList.add("hidden");
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    selectedFile = null;
    analyzeBtn.disabled = true;
    fileMeta.textContent = "ファイルが大きすぎます。20MB以下のCSVを選んでください。";
    showError("現在の版では20MB以下のファイルに対応しています。");
    return;
  }
  selectedFile = file;
  analyzeBtn.disabled = false;
  fileMeta.textContent = `${file.name} ・ ${formatBytes(file.size)}`;
}

async function analyzeFile() {
  if (!selectedFile) return;
  errorEl.textContent = "";
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "診断中…";
  try {
    const buffer = await selectedFile.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const chosen = encodingSelect.value;
    let decoded;
    if (chosen === "auto") {
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        lastEncoding = "utf-8";
      } else {
        // UTF-8として厳密に読めるかを試し、失敗した場合のみShift_JIS系を候補にする
        try {
          decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          lastEncoding = "utf-8";
        } catch {
          lastEncoding = "shift_jis";
        }
      }
    } else {
      lastEncoding = chosen;
    }
    if (decoded === undefined) decoded = new TextDecoder(lastEncoding, { fatal: false }).decode(bytes);
    decoded = decoded.replace(/^\uFEFF/, "");
    parsedRows = parseCsv(decoded);
    if (!parsedRows.length) throw new Error("CSVに読み取れる行がありません。");
    lastReport = diagnose(parsedRows);
    renderResults(lastReport);
    results.classList.remove("hidden");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showError(`読み込みに失敗しました。CSV形式と文字コードを確認してください。${err && err.message ? "（" + err.message + "）" : ""}`);
  } finally {
    analyzeBtn.disabled = !selectedFile;
    analyzeBtn.textContent = "CSVを診断する";
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
    } else {
      if (ch === '"' && cell.length === 0) quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n") {
        row.push(cell.replace(/\r$/, ""));
        if (!(row.length === 1 && row[0] === "" && rows.length === 0)) rows.push(row);
        row = []; cell = "";
      } else cell += ch;
    }
  }
  row.push(cell.replace(/\r$/, ""));
  if (row.some(v => v !== "") || row.length > 1) rows.push(row);
  if (quoted) throw new Error("閉じていないダブルクォートが見つかりました。");
  return rows;
}

function diagnose(rows) {
  const header = rows[0] || [];
  const dataRows = rows.slice(1);
  const expected = header.length;
  const mismatch = [];
  dataRows.forEach((r, i) => { if (r.length !== expected) mismatch.push({ line: i + 2, count: r.length }); });
  const blankHeaders = [];
  const duplicateHeaders = [];
  const seenHeaders = new Set();
  header.forEach((h, i) => {
    const name = h.trim();
    if (!name) blankHeaders.push(i + 1);
    const key = name.toLocaleLowerCase();
    if (key && seenHeaders.has(key)) duplicateHeaders.push(name);
    if (key) seenHeaders.add(key);
  });
  const seenRows = new Set();
  let duplicateRows = 0;
  dataRows.forEach(r => {
    const key = JSON.stringify(r);
    if (seenRows.has(key)) duplicateRows++;
    seenRows.add(key);
  });
  const emptyRows = dataRows.filter(r => r.every(v => v.trim() === "")).length;
  return { rows, header, dataRows, expected, mismatch, blankHeaders, duplicateHeaders, duplicateRows, emptyRows };
}

function renderResults(r) {
  summary.innerHTML = "";
  [
    ["全行数", r.rows.length],
    ["列数（見出し行）", r.expected],
    ["要確認の行", r.mismatch.length]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "summary-card";
    const span = document.createElement("span"); span.textContent = label;
    const strong = document.createElement("strong"); strong.textContent = value.toLocaleString("ja-JP");
    card.append(span, strong); summary.append(card);
  });

  checks.innerHTML = "";
  const items = [
    r.mismatch.length ? ["warn", "!", `列数の不一致：${r.mismatch.length}行`, `見出し行は${r.expected}列です。不一致の行番号：${r.mismatch.slice(0, 10).map(x => x.line).join(", ")}${r.mismatch.length > 10 ? " ほか" : ""}`] : ["ok", "✓", "列数の不一致なし", "データ行の列数は見出し行と一致しています。"],
    r.blankHeaders.length ? ["warn", "!", `空の見出し：${r.blankHeaders.length}列`, `該当列：${r.blankHeaders.join(", ")}`] : ["ok", "✓", "空の見出しなし", "見出し行に空欄は見つかりませんでした。"],
    r.duplicateHeaders.length ? ["warn", "!", `重複した見出し：${r.duplicateHeaders.length}件`, `該当する名前：${[...new Set(r.duplicateHeaders)].join(", ")}`] : ["ok", "✓", "重複した見出しなし", "同じ名前の見出しは見つかりませんでした。"],
    r.duplicateRows ? ["warn", "!", `重複行：${r.duplicateRows}件`, "完全に同じ内容のデータ行が複数あります。ダウンロード時に削除できます。"] : ["ok", "✓", "重複行なし", "完全に同じ内容のデータ行は見つかりませんでした。"],
    r.emptyRows ? ["warn", "!", `空行：${r.emptyRows}行`, "空のデータ行が含まれています。必要に応じて元ファイルを確認してください。"] : ["ok", "✓", "空行なし", "完全な空行は見つかりませんでした。"],
    ["ok", "i", `読み込み文字コード：${lastEncoding === "shift_jis" ? "Shift_JIS系（推定）" : "UTF-8（推定または指定）"}`, "自動判定は完全ではありません。プレビューが文字化けしている場合は、文字コードを切り替えて再診断してください。"]
  ];
  items.forEach(([kind, icon, title, detail]) => {
    const item = document.createElement("div"); item.className = `check-item ${kind}`;
    const mark = document.createElement("span"); mark.className = "check-icon"; mark.textContent = icon;
    const body = document.createElement("div");
    const strong = document.createElement("strong"); strong.textContent = title;
    const p = document.createElement("div"); p.textContent = detail;
    body.append(strong, p); item.append(mark, body); checks.append(item);
  });
  renderPreview(r.rows.slice(0, 10));
}

function renderPreview(rows) {
  preview.innerHTML = "";
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const el = document.createElement(rowIndex === 0 ? "th" : "td");
      el.textContent = cell;
      tr.append(el);
    });
    preview.append(tr);
  });
}

function downloadCsv() {
  if (!lastReport) return;
  let rows = lastReport.rows.map(row => row.map(cell => trimCells.checked ? cell.trim() : cell));
  if (removeDuplicates.checked && rows.length > 1) {
    const header = rows[0];
    const seen = new Set();
    rows = [header, ...rows.slice(1).filter(row => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })];
  }
  const csv = rows.map(row => row.map(escapeCsv).join(",")).join("\r\n");
  const prefix = outputEncoding.value === "utf-8-bom" ? "\uFEFF" : "";
  const blob = new Blob([prefix, csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const baseName = (selectedFile?.name || "data.csv").replace(/\.[^.]+$/, "");
  a.download = `${baseName}_修復.csv`;
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function escapeCsv(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function showError(message) { errorEl.textContent = message; }
