"use strict";
(function () {
  const core = window.CsvCompareCore;
  const $ = id => document.getElementById(id);
  const beforeFile = $("before-file"), afterFile = $("after-file");
  const compareBtn = $("compare-btn"), errorEl = $("compare-error");
  const resultsEl = $("compare-results"), downloadBtn = $("compare-download");
  const MAX_BYTES = 20 * 1024 * 1024;
  let currentResult = null;
  let taskId = 0;

  function fileSize(n) { return n < 1024 * 1024 ? Math.round(n / 1024) + " KB" : (n / (1024 * 1024)).toFixed(1) + " MB"; }
  function reset() {
    ++taskId; currentResult = null; errorEl.textContent = "";
    resultsEl.classList.add("hidden"); downloadBtn.disabled = true;
    $("before-info").textContent = beforeFile.files[0] ? `${beforeFile.files[0].name}（${fileSize(beforeFile.files[0].size)}）` : "選択されていません";
    $("after-info").textContent = afterFile.files[0] ? `${afterFile.files[0].name}（${fileSize(afterFile.files[0].size)}）` : "選択されていません";
    compareBtn.disabled = !(beforeFile.files.length && afterFile.files.length);
  }
  for (const id of ["before-file", "after-file", "before-encoding", "after-encoding", "before-delimiter", "after-delimiter", "key-column"]) {
    $(id).addEventListener("change", reset);
  }
  for (const radio of document.querySelectorAll('input[name="compare-mode"]')) {
    radio.addEventListener("change", () => {
      $("key-settings").classList.toggle("hidden", document.querySelector('input[name="compare-mode"]:checked').value !== "key");
      reset();
    });
  }
  function render(result) {
    const { counts, entries } = result;
    const sum = $("compare-summary"); sum.replaceChildren();
    [["追加", counts.added], ["削除", counts.removed], ["変更", counts.changed], ["一致", counts.unchanged]].forEach(([name, value]) => {
      const card = document.createElement("div"); card.className = "summary-card";
      const label = document.createElement("span"); label.textContent = name;
      const amount = document.createElement("strong"); amount.textContent = value.toLocaleString("ja-JP");
      card.append(label, amount); sum.append(card);
    });
    $("compare-status").textContent = entries.length ? `差分 ${entries.length.toLocaleString("ja-JP")} 件` : "差分なし";
    const tbody = $("compare-tbody"); tbody.replaceChildren();
    const labels = { added: "追加", removed: "削除", changed: "変更" };
    if (!entries.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 5; td.textContent = "差分は見つかりませんでした。"; tr.append(td); tbody.append(tr);
    }
    for (const e of entries.slice(0, 50)) {
      const tr = document.createElement("tr");
      const values = [labels[e.type], e.key || "—", e.columns.map(i => result.header[i]).join("、") || "—", preview(e.oldRow), preview(e.newRow)];
      values.forEach((value, i) => {
        const td = document.createElement("td");
        td.textContent = value;
        if (i >= 3) td.title = value;
        tr.append(td);
      });
      tbody.append(tr);
    }
    $("compare-description").textContent = `${entries.length.toLocaleString("ja-JP")}件の差分のうち、先頭${Math.min(entries.length, 50)}件を表示します（変更のない行は非表示）。ダウンロードは全差分が対象です。`;
    downloadBtn.disabled = !entries.length;
    resultsEl.classList.remove("hidden");
    resultsEl.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function preview(row) {
    if (!row) return "—";
    const content = row.join(" ｜ ").replace(/\n/g, "↵");
    return content.length > 180 ? content.slice(0, 180) + "…" : content;
  }
  async function readOne(file, name, encoding, delimiter) {
    if (!file || file.size === 0) throw new Error(`${name}に空のファイルが選択されています。`);
    if (file.size > MAX_BYTES) throw new Error(`${name}のサイズが20MBを超えています。`);
    const { text } = core.decode(new Uint8Array(await file.arrayBuffer()), encoding);
    try { return core.readCsv(text, delimiter); }
    catch (e) { throw new Error(`${name}：${e.message}`); }
  }
  compareBtn.addEventListener("click", async () => {
    if (!beforeFile.files[0] || !afterFile.files[0]) return;
    const myId = ++taskId;
    errorEl.textContent = ""; resultsEl.classList.add("hidden"); currentResult = null;
    compareBtn.disabled = true; compareBtn.textContent = "比較中…";
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      const before = await readOne(beforeFile.files[0], "変更前CSV", $("before-encoding").value, $("before-delimiter").value);
      const after = await readOne(afterFile.files[0], "変更後CSV", $("after-encoding").value, $("after-delimiter").value);
      if (myId !== taskId) return;
      const mode = document.querySelector('input[name="compare-mode"]:checked').value;
      const key = Number($("key-column").value);
      if (mode === "key" && (!/^\d+$/.test($("key-column").value) || key < 1)) throw new Error("キー列には1以上の整数を入力してください。");
      currentResult = core.compareRows(before, after, mode, key - 1);
      render(currentResult);
    } catch (e) {
      if (myId === taskId) errorEl.textContent = `比較できませんでした：${e.message || "CSVファイルを確認してください。"}`;
    } finally {
      if (myId === taskId) { compareBtn.disabled = false; compareBtn.textContent = "2つのCSVを比較する"; }
    }
  });
  downloadBtn.addEventListener("click", () => {
    if (!currentResult || !currentResult.entries.length) return;
    const blob = new Blob([core.makeReportCsv(currentResult)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "csv-rescue-diff.csv";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  reset();
})();
