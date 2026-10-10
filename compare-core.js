"use strict";
// CSVレスキュー v6: ブラウザだけで動く差分比較の純粋関数。外部送信・依存ライブラリなし。
(function (root) {
  const MAX_ROWS = 100000;

  function decode(bytes, chosen = "auto") {
    let encoding = chosen;
    if (chosen === "auto") {
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = "utf-8";
      else {
        try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); encoding = "utf-8"; }
        catch { encoding = "shift_jis"; }
      }
    }
    let text;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error("文字コードが合いません。UTF-8またはShift_JISを明示的に選んでください。"); }
    return { text: text.replace(/^\uFEFF/, ""), encoding };
  }

  function detectDelimiter(text) {
    const candidates = [",", "\t", ";"];
    const totals = [[], [], []];
    let quoted = false, atCellStart = true, counts = [0, 0, 0], completed = 0;
    for (let i = 0; i < text.length && i < 150000 && completed < 30; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { i++; continue; }
        if (quoted) { quoted = false; continue; }
        if (atCellStart) { quoted = true; continue; }
      }
      if (quoted) continue;
      if (c === "\n" || c === "\r") {
        totals.forEach((t, n) => t.push(counts[n]));
        counts = [0, 0, 0]; atCellStart = true; completed++;
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else {
        const n = candidates.indexOf(c);
        if (n >= 0) { counts[n]++; atCellStart = true; }
        else if (c !== " " && c !== "\t") atCellStart = false;
      }
    }
    if (counts.some(n => n > 0)) totals.forEach((t, n) => t.push(counts[n]));
    let winner = 0, best = -1;
    totals.forEach((values, n) => {
      const positive = values.filter(x => x > 0);
      if (!positive.length) return;
      const freq = new Map();
      positive.forEach(x => freq.set(x, (freq.get(x) || 0) + 1));
      const score = Math.max(...freq.values()) * 10000 + positive.length * 100 + positive.reduce((a, b) => a + b, 0);
      if (score > best) { best = score; winner = n; }
    });
    return candidates[winner];
  }

  // RFC4180の引用符、セル内改行、二重引用符エスケープに対応。
  function parseDelimited(text, separator = ",") {
    const rows = [], lines = [];
    let row = [], field = "", state = "start", line = 1, rowStart = 1;
    const fieldDone = () => { row.push(field); field = ""; state = "start"; };
    const rowDone = () => {
      fieldDone(); rows.push(row); lines.push(rowStart);
      if (rows.length > MAX_ROWS + 1) throw new Error(`行数が多すぎます（上限${MAX_ROWS.toLocaleString("ja-JP")}データ行）。`);
      row = [];
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const newline = c === "\n" || c === "\r";
      if (state === "quoted") {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else state = "afterQuote";
        } else if (newline) {
          field += "\n";
          if (c === "\r" && text[i + 1] === "\n") i++;
          line++;
        } else field += c;
        continue;
      }
      if (state === "afterQuote") {
        if (c === separator) { fieldDone(); continue; }
        if (newline) {
          rowDone(); if (c === "\r" && text[i + 1] === "\n") i++;
          line++; rowStart = line; continue;
        }
        if (c === " " || c === "\t") continue;
        throw new Error(`${line}行目の引用符の後に不正な文字があります。`);
      }
      if (c === separator) { fieldDone(); continue; }
      if (newline) {
        rowDone(); if (c === "\r" && text[i + 1] === "\n") i++;
        line++; rowStart = line; continue;
      }
      if (state === "start" && c === '"') { state = "quoted"; continue; }
      field += c; state = "plain";
    }
    if (state === "quoted") throw new Error(`${rowStart}行目からの引用符が閉じていません。`);
    // 末尾の改行で架空の行を増やさない。実データとしての空行は保持。
    if (row.length || field.length || state === "plain" || state === "afterQuote") rowDone();
    return { rows, lines };
  }

  function readCsv(text, delimiterChoice = "auto") {
    const delimiter = delimiterChoice === "auto" ? detectDelimiter(text) : (delimiterChoice === "tab" ? "\t" : delimiterChoice);
    const { rows, lines } = parseDelimited(text, delimiter);
    if (!rows.length || rows[0].every(x => x.trim() === "")) throw new Error("見出し行がありません。CSVを確認してください。");
    const header = rows[0];
    const data = rows.slice(1);
    for (let i = 0; i < data.length; i++) {
      if (data[i].length !== header.length) {
        throw new Error(`データの${lines[i + 1]}行目は${data[i].length}列、見出しは${header.length}列です。列ズレを修正してから比較してください。`);
      }
    }
    return { header, data, lines: lines.slice(1), delimiter };
  }

  function compareRows(before, after, mode = "key", keyCol = 0) {
    if (before.header.length !== after.header.length || before.header.some((v, i) => v !== after.header[i])) {
      throw new Error("2つのCSVの見出し（列名・列順）が異なります。列名と列順を揃えてから比較してください。");
    }
    if (mode !== "key" && mode !== "whole") throw new Error("比較方法が不正です。");
    const header = before.header;
    if (mode === "key" && (!Number.isInteger(keyCol) || keyCol < 0 || keyCol >= header.length)) {
      throw new Error(`キー列は1〜${header.length}の整数で指定してください。`);
    }
    const entries = [];
    const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    const push = (type, key, oldRow, newRow, columns) => {
      entries.push({ type, key, oldRow, newRow, columns });
      counts[type]++;
    };
    if (mode === "key") {
      const indexData = (file, label) => {
        const map = new Map();
        file.data.forEach((row, i) => {
          const key = row[keyCol];
          if (!key || key.trim() === "") throw new Error(`${label}の${file.lines[i]}行目：キー列が空欄です。空欄のないID列を選んでください。`);
          if (map.has(key)) throw new Error(`${label}の${file.lines[i]}行目：キー「${key.slice(0, 60)}」が重複しています。重複を整理してから比較してください。`);
          map.set(key, row);
        });
        return map;
      };
      const left = indexData(before, "変更前CSV");
      const right = indexData(after, "変更後CSV");
      // 削除・変更は元データ順、追加は新データ順で並べる。
      for (const [key, oldRow] of left) {
        if (!right.has(key)) push("removed", key, oldRow, null, []);
        else {
          const newRow = right.get(key);
          const changedCols = header.map((_, i) => i).filter(i => oldRow[i] !== newRow[i]);
          if (changedCols.length) push("changed", key, oldRow, newRow, changedCols);
          else counts.unchanged++;
        }
      }
      for (const [key, newRow] of right) if (!left.has(key)) push("added", key, null, newRow, []);
    } else {
      // 重複行の個数を含めた比較（集合ではなく多重集合）。行順は無視。
      const oldCounts = new Map(), newCounts = new Map();
      for (const row of before.data) { const k = JSON.stringify(row); oldCounts.set(k, (oldCounts.get(k) || 0) + 1); }
      for (const row of after.data) { const k = JSON.stringify(row); newCounts.set(k, (newCounts.get(k) || 0) + 1); }
      const shared = new Map();
      for (const [key, count] of oldCounts) shared.set(key, Math.min(count, newCounts.get(key) || 0));
      const beforeRemaining = new Map(shared), afterRemaining = new Map(shared);
      for (const row of before.data) {
        const key = JSON.stringify(row), available = beforeRemaining.get(key) || 0;
        if (available) { counts.unchanged++; beforeRemaining.set(key, available - 1); }
        else push("removed", "", row, null, []);
      }
      for (const row of after.data) {
        const key = JSON.stringify(row), available = afterRemaining.get(key) || 0;
        if (available) afterRemaining.set(key, available - 1);
        else push("added", "", null, row, []);
      }
    }
    return { header, entries, counts, mode, keyCol };
  }

  const status = { added: "追加", removed: "削除", changed: "変更" };
  function safeSpreadsheetCell(value) {
    const text = String(value ?? "");
    // Excel / LibreOfficeなどでのCSV数式注入を防ぐ（書き出す差分レポートに限る）。
    return /^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  }
  function quoteCsv(value) { return '"' + safeSpreadsheetCell(value).replace(/"/g, '""') + '"'; }
  function makeReportCsv(result) {
    const { header, entries } = result;
    const head = ["状態", "キー", "変更した列", ...header.map(h => `変更前_${h}`), ...header.map(h => `変更後_${h}`)];
    const rows = [head, ...entries.map(e => [status[e.type], e.key, e.columns.map(i => header[i]).join(" / "),
      ...(e.oldRow || header.map(() => "")), ...(e.newRow || header.map(() => ""))])];
    return "\uFEFF" + rows.map(row => row.map(quoteCsv).join(",")).join("\r\n") + "\r\n";
  }

  const api = { decode, detectDelimiter, parseDelimited, readCsv, compareRows, makeReportCsv, safeSpreadsheetCell, MAX_ROWS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.CsvCompareCore = api;
})(typeof window !== "undefined" ? window : globalThis);
