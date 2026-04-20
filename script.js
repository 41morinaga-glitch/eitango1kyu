const SPEAK_KEY = "eitango.speak.v1";
const MODE_KEY = "eitango.mode.v1";
const LEVEL_KEY = "eitango.level.v1";
const storageKeyFor = lv => `eitango.words.${lv}.v1`;
const mySampleKeyFor = lv => `eitango.mysample.${lv}.v1`;

const LEVEL_TITLE = { "1kyu": "英検1級 英単語", "2kyu": "英検2級 英単語" };

let level = localStorage.getItem(LEVEL_KEY) === "2kyu" ? "2kyu" : "1kyu";

// 旧キーからの移行（1回のみ）
(function migrateLegacy() {
  const OLD_WORDS = "eitango1kyu.words.v1";
  const oldWords = localStorage.getItem(OLD_WORDS);
  if (oldWords && !localStorage.getItem(storageKeyFor("1kyu"))) {
    localStorage.setItem(storageKeyFor("1kyu"), oldWords);
  }
  if (oldWords) localStorage.removeItem(OLD_WORDS);

  const OLD_SPEAK = "eitango1kyu.speak.v1";
  if (localStorage.getItem(OLD_SPEAK) && !localStorage.getItem(SPEAK_KEY)) {
    localStorage.setItem(SPEAK_KEY, localStorage.getItem(OLD_SPEAK));
  }
  localStorage.removeItem(OLD_SPEAK);

  const OLD_MODE = "eitango1kyu.mode.v1";
  if (localStorage.getItem(OLD_MODE) && !localStorage.getItem(MODE_KEY)) {
    localStorage.setItem(MODE_KEY, localStorage.getItem(OLD_MODE));
  }
  localStorage.removeItem(OLD_MODE);
})();

let words = loadWords();
let mySample = loadMySample();
let list = [];
let index = 0;
let editingId = null;
let msEditingId = null;
let autoSpeak = localStorage.getItem(SPEAK_KEY) === "1";
let mode = localStorage.getItem(MODE_KEY) === "jaen" ? "jaen" : "enja";

function loadWords() {
  try {
    const raw = localStorage.getItem(storageKeyFor(level));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveWords() {
  localStorage.setItem(storageKeyFor(level), JSON.stringify(words));
}

function loadMySample() {
  try {
    const raw = localStorage.getItem(mySampleKeyFor(level));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveMySample() {
  localStorage.setItem(mySampleKeyFor(level), JSON.stringify(mySample));
}

function sampleFor(lv) {
  if (lv === "2kyu") return typeof WORDS_2KYU !== "undefined" ? WORDS_2KYU : [];
  return typeof WORDS_1KYU !== "undefined" ? WORDS_1KYU : [];
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ========== 発音（Web Speech API） ========== */
const synth = window.speechSynthesis;
let enVoice = null;
let synthPrimed = false;

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices.length) return;
  enVoice =
    voices.find(v => v.lang === "en-US" && /Samantha|Alex|Ava|Karen|Daniel/i.test(v.name)) ||
    voices.find(v => v.lang === "en-US") ||
    voices.find(v => v.lang && v.lang.startsWith("en")) ||
    null;
}
if (synth) {
  pickVoice();
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", pickVoice);
  } else {
    synth.onvoiceschanged = pickVoice;
  }
}

// iOS/Safariで初回のユーザー操作時に発音を解除する
function primeSynth() {
  if (synthPrimed || !synth) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    u.volume = 0;
    synth.speak(u);
    synthPrimed = true;
  } catch (e) {}
}
document.addEventListener("click", primeSynth, { once: false, capture: true });
document.addEventListener("touchstart", primeSynth, { passive: true });

function doSpeak(text, opts) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  if (enVoice) u.voice = enVoice;
  u.rate = opts.rate || 0.95;
  u.pitch = 1;
  u.volume = 1;
  if (opts.onstart) u.onstart = opts.onstart;
  u.onend = () => { if (opts.onend) opts.onend(); };
  u.onerror = () => { if (opts.onend) opts.onend(); };
  // Chrome desktopが長時間アイドルで一時停止していた場合
  if (synth.paused) synth.resume();
  synth.speak(u);
}

function speak(text, opts = {}) {
  if (!synth || !text) return;
  // Chrome/Safariの既知の問題: cancel()直後のspeak()が無視されることがある
  if (synth.speaking || synth.pending) {
    synth.cancel();
    setTimeout(() => doSpeak(text, opts), 120);
  } else {
    doSpeak(text, opts);
  }
}

function speakWithIndicator(text, btn, rate) {
  if (!btn) { speak(text, { rate }); return; }
  if (btn.classList.contains("speaking")) {
    synth && synth.cancel();
    btn.classList.remove("speaking");
    return;
  }
  speak(text, {
    rate,
    onstart: () => btn.classList.add("speaking"),
    onend: () => btn.classList.remove("speaking"),
  });
}

/* ========== タブ切替 ========== */
document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(tab.dataset.view + "View").classList.add("active");
    if (tab.dataset.view === "study") resetStudy();
    else renderList();
  });
});

/* ========== 学習ビュー ========== */
const card = document.getElementById("card");
const frontContent = document.getElementById("frontContent");
const backContent = document.getElementById("backContent");
const frontHint = document.getElementById("frontHint");
const currentEl = document.getElementById("current");
const totalEl = document.getElementById("total");
const emptyMsg = document.getElementById("emptyMsg");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const flipBtn = document.getElementById("flipBtn");
const shuffleBtn = document.getElementById("shuffleBtn");
const resetBtn = document.getElementById("resetBtn");
const speakToggle = document.getElementById("speakToggle");
const speakBtn = document.getElementById("speakBtn");
const speakBtnBack = document.getElementById("speakBtnBack");

speakToggle.checked = autoSpeak;
speakToggle.addEventListener("change", () => {
  autoSpeak = speakToggle.checked;
  localStorage.setItem(SPEAK_KEY, autoSpeak ? "1" : "0");
  if (autoSpeak && list.length > 0) speak(list[index].word);
  else synth && synth.cancel();
});

speakBtn.addEventListener("click", e => {
  e.stopPropagation();
  if (list.length > 0) speakWithIndicator(list[index].word, speakBtn);
});
speakBtnBack.addEventListener("click", e => {
  e.stopPropagation();
  if (list.length > 0) {
    const w = list[index];
    const text = w.example || w.word;
    speakWithIndicator(text, speakBtnBack, 0.9);
  }
});

function resetStudy() {
  list = [...words];
  index = 0;
  render();
}

function renderFaces(w) {
  frontContent.innerHTML = "";
  backContent.innerHTML = "";

  if (mode === "enja") {
    const wd = document.createElement("div");
    wd.className = "word";
    wd.textContent = w.word;
    frontContent.appendChild(wd);
    if (w.pos) {
      const ps = document.createElement("div");
      ps.className = "pos";
      ps.textContent = w.pos;
      frontContent.appendChild(ps);
    }
    frontHint.textContent = "タップで意味を表示";

    const m = document.createElement("div");
    m.className = "meaning";
    m.textContent = w.meaning;
    backContent.appendChild(m);
    if (w.example) {
      const e = document.createElement("div");
      e.className = "example";
      e.textContent = w.example;
      backContent.appendChild(e);
    }
    if (w.exampleJa) {
      const ej = document.createElement("div");
      ej.className = "example-ja";
      ej.textContent = w.exampleJa;
      backContent.appendChild(ej);
    }
  } else {
    const m = document.createElement("div");
    m.className = "meaning";
    m.textContent = w.meaning;
    frontContent.appendChild(m);
    if (w.pos) {
      const ps = document.createElement("div");
      ps.className = "pos";
      ps.textContent = w.pos;
      frontContent.appendChild(ps);
    }
    frontHint.textContent = "タップで英単語を表示";

    const wd = document.createElement("div");
    wd.className = "word";
    wd.textContent = w.word;
    backContent.appendChild(wd);
    if (w.example) {
      const e = document.createElement("div");
      e.className = "example";
      e.textContent = w.example;
      backContent.appendChild(e);
    }
    if (w.exampleJa) {
      const ej = document.createElement("div");
      ej.className = "example-ja";
      ej.textContent = w.exampleJa;
      backContent.appendChild(ej);
    }
  }
}

function render() {
  const hasWords = list.length > 0;
  card.hidden = !hasWords;
  emptyMsg.hidden = hasWords;
  [prevBtn, nextBtn, flipBtn, shuffleBtn, resetBtn].forEach(b => b.disabled = !hasWords);
  if (!hasWords) {
    currentEl.textContent = 0;
    totalEl.textContent = 0;
    return;
  }
  const w = list[index];
  renderFaces(w);
  currentEl.textContent = index + 1;
  totalEl.textContent = list.length;
  card.classList.remove("flipped");
  prevBtn.disabled = index === 0;
  nextBtn.disabled = index === list.length - 1;
  speakBtn.classList.remove("speaking");
  speakBtnBack.classList.remove("speaking");
  if (autoSpeak) speak(w.word);
}

/* ========== 表示モード切替 ========== */
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.mode === mode) return;
    mode = btn.dataset.mode;
    localStorage.setItem(MODE_KEY, mode);
    document.querySelectorAll(".mode-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.mode === mode));
    render();
  });
});
document.querySelectorAll(".mode-btn").forEach(b =>
  b.classList.toggle("active", b.dataset.mode === mode));

/* ========== スワイプ操作 ========== */
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;

card.addEventListener("touchstart", e => {
  if (e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchMoved = false;
}, { passive: true });

card.addEventListener("touchmove", e => {
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) touchMoved = true;
}, { passive: true });

card.addEventListener("touchend", e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0) swipeNext();
    else swipePrev();
  }
});

let pointerStartX = null;
let pointerStartY = null;
card.addEventListener("pointerdown", e => {
  if (e.pointerType !== "mouse") return;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
});
card.addEventListener("pointerup", e => {
  if (e.pointerType !== "mouse" || pointerStartX === null) return;
  const dx = e.clientX - pointerStartX;
  const dy = e.clientY - pointerStartY;
  pointerStartX = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    touchMoved = true;
    if (dx < 0) swipeNext();
    else swipePrev();
  }
});

function swipeNext() {
  if (index >= list.length - 1) return;
  card.classList.add("swipe-left");
  setTimeout(() => {
    card.classList.remove("swipe-left");
    index++;
    render();
    card.classList.add("swipe-in-right");
    setTimeout(() => card.classList.remove("swipe-in-right"), 260);
  }, 220);
}

function swipePrev() {
  if (index <= 0) return;
  card.classList.add("swipe-right");
  setTimeout(() => {
    card.classList.remove("swipe-right");
    index--;
    render();
    card.classList.add("swipe-in-left");
    setTimeout(() => card.classList.remove("swipe-in-left"), 260);
  }, 220);
}

card.addEventListener("click", e => {
  if (touchMoved) { touchMoved = false; return; }
  card.classList.toggle("flipped");
});
flipBtn.addEventListener("click", e => { e.stopPropagation(); card.classList.toggle("flipped"); });
nextBtn.addEventListener("click", () => { if (index < list.length - 1) { index++; render(); } });
prevBtn.addEventListener("click", () => { if (index > 0) { index--; render(); } });
shuffleBtn.addEventListener("click", () => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  index = 0;
  render();
});
resetBtn.addEventListener("click", resetStudy);

document.addEventListener("keydown", e => {
  if (!document.getElementById("studyView").classList.contains("active")) return;
  if (e.target.tagName === "INPUT") return;
  if (e.key === "ArrowRight") nextBtn.click();
  else if (e.key === "ArrowLeft") prevBtn.click();
  else if (e.key === " " || e.key === "Enter") { e.preventDefault(); card.classList.toggle("flipped"); }
});

/* ========== 管理ビュー：フォーム ========== */
const form = document.getElementById("wordForm");
const formTitle = document.getElementById("formTitle");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelBtn");
const fWord = document.getElementById("fWord");
const fPos = document.getElementById("fPos");
const fMeaning = document.getElementById("fMeaning");
const fExample = document.getElementById("fExample");
const fExampleJa = document.getElementById("fExampleJa");

form.addEventListener("submit", e => {
  e.preventDefault();
  const data = {
    word: fWord.value.trim(),
    pos: fPos.value.trim(),
    meaning: fMeaning.value.trim(),
    example: fExample.value.trim(),
    exampleJa: fExampleJa.value.trim(),
  };
  if (!data.word || !data.meaning) return;

  if (editingId) {
    const i = words.findIndex(w => w.id === editingId);
    if (i >= 0) words[i] = { ...words[i], ...data };
    exitEditMode();
  } else {
    words.push({ id: uid(), ...data });
  }
  saveWords();
  form.reset();
  fWord.focus();
  renderList();
});

cancelBtn.addEventListener("click", exitEditMode);

function enterEditMode(id) {
  const w = words.find(x => x.id === id);
  if (!w) return;
  editingId = id;
  formTitle.textContent = "単語を編集";
  saveBtn.textContent = "更新する";
  cancelBtn.hidden = false;
  fWord.value = w.word;
  fPos.value = w.pos || "";
  fMeaning.value = w.meaning;
  fExample.value = w.example || "";
  fExampleJa.value = w.exampleJa || "";
  fWord.focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function exitEditMode() {
  editingId = null;
  formTitle.textContent = "単語を追加";
  saveBtn.textContent = "追加する";
  cancelBtn.hidden = true;
  form.reset();
}

/* ========== 管理ビュー：リスト ========== */
const wordList = document.getElementById("wordList");
const listCount = document.getElementById("listCount");
const searchInput = document.getElementById("searchInput");

function renderList() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? words.filter(w =>
        w.word.toLowerCase().includes(q) ||
        (w.meaning || "").toLowerCase().includes(q))
    : words;

  listCount.textContent = words.length;
  wordList.innerHTML = "";

  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-list";
    li.textContent = words.length === 0 ? "まだ単語がありません" : "該当する単語がありません";
    wordList.appendChild(li);
    return;
  }

  filtered.forEach(w => {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "info";
    const wd = document.createElement("div");
    wd.className = "w";
    wd.textContent = w.word;
    const md = document.createElement("div");
    md.className = "m";
    md.textContent = w.meaning;
    info.appendChild(wd);
    info.appendChild(md);

    const actions = document.createElement("div");
    actions.className = "actions";
    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.textContent = "✏️";
    editBtn.title = "編集";
    editBtn.onclick = () => enterEditMode(w.id);
    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.textContent = "🗑";
    delBtn.title = "削除";
    delBtn.onclick = () => {
      if (!confirm(`「${w.word}」を削除しますか？`)) return;
      words = words.filter(x => x.id !== w.id);
      saveWords();
      renderList();
    };
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(info);
    li.appendChild(actions);
    wordList.appendChild(li);
  });
}

searchInput.addEventListener("input", renderList);

/* ========== データ入出力 ========== */
document.getElementById("exportBtn").addEventListener("click", () => {
  const data = words.map(({ id, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `eitango_${level}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    let imported = [];
    if (file.name.endsWith(".json")) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("配列形式ではありません");
      imported = parsed;
    } else if (file.name.endsWith(".csv")) {
      imported = parseCSV(text);
    }
    const normalized = imported
      .map(w => ({
        id: uid(),
        word: (w.word || "").trim(),
        pos: (w.pos || "").trim(),
        meaning: (w.meaning || "").trim(),
        example: (w.example || "").trim(),
        exampleJa: (w.exampleJa || "").trim(),
      }))
      .filter(w => w.word && w.meaning);

    if (normalized.length === 0) {
      alert("有効な単語が見つかりませんでした。");
      return;
    }

    const proceed = confirm(
      `${normalized.length}件の単語を読み込みます。\n\n「OK」→ 既存データに追加\n「キャンセル」→ 何もしない`
    );
    if (!proceed) { e.target.value = ""; return; }

    const replaceAll = confirm("既存データを全て置き換えますか？\n「OK」→ 置き換え\n「キャンセル」→ 追加");
    if (replaceAll) words = normalized;
    else words = words.concat(normalized);

    saveWords();
    renderList();
    alert(`${normalized.length}件を読み込みました。`);
  } catch (err) {
    alert("ファイルの読み込みに失敗しました: " + err.message);
  }
  e.target.value = "";
});

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = parseCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i] || ""; });
    return obj;
  });
}

function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === ",") { result.push(cur); cur = ""; }
      else if (c === '"') { inQuotes = true; }
      else { cur += c; }
    }
  }
  result.push(cur);
  return result;
}

document.getElementById("loadSampleBtn").addEventListener("click", () => {
  const lvName = level === "2kyu" ? "英検2級" : "英検1級";
  const builtIn = sampleFor(level);
  const myCount = mySample.length;
  const total = builtIn.length + myCount;
  const msg = myCount > 0
    ? `${lvName}のサンプル単語（${builtIn.length}件）＋ マイサンプル（${myCount}件）＝ 計${total}件を既存データに追加します。よろしいですか？`
    : `${lvName}のサンプル単語 ${builtIn.length}件を既存データに追加します。よろしいですか？`;
  if (!confirm(msg)) return;
  const toAdd = [...builtIn, ...mySample].map(w => ({
    id: uid(),
    word: w.word, pos: w.pos, meaning: w.meaning,
    example: w.example, exampleJa: w.exampleJa,
  }));
  words = words.concat(toAdd);
  saveWords();
  renderList();
  alert(`${toAdd.length}件を追加しました。`);
});

document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (!confirm("全ての単語を削除します。元に戻せません。本当によろしいですか？")) return;
  if (!confirm("本当に全て削除しますか？（最終確認）")) return;
  words = [];
  saveWords();
  renderList();
});

/* ========== 教科書から取り込み ========== */
const importTextEl = document.getElementById("importText");
const importFormatEl = document.getElementById("importFormat");
const previewImportBtn = document.getElementById("previewImportBtn");
const importPreview = document.getElementById("importPreview");
const previewListEl = document.getElementById("previewList");
const previewCount = document.getElementById("previewCount");
const confirmImportBtn = document.getElementById("confirmImportBtn");
const cancelImportBtn = document.getElementById("cancelImportBtn");
const ocrFile = document.getElementById("ocrFile");
const ocrStatus = document.getElementById("ocrStatus");
let parsedImport = [];

document.querySelectorAll(".import-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".import-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("pasteMethod").hidden = tab.dataset.method !== "paste";
    document.getElementById("photoMethod").hidden = tab.dataset.method !== "photo";
  });
});

function stripBullet(line) {
  return line
    .replace(/^[\s•・◆◇○●*►→]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function parseImportLine(rawLine) {
  const line = stripBullet(rawLine);
  if (!line) return null;
  // word | meaning | example | exampleJa
  if (/\s*[|｜]\s*/.test(line) && line.split(/\s*[|｜]\s*/).length >= 2) {
    const p = line.split(/\s*[|｜]\s*/).map(s => s.trim());
    if (p[0] && p[1]) return { word: p[0], meaning: p[1], example: p[2] || "", exampleJa: p[3] || "", pos: "" };
  }
  // tab-separated single line
  if (line.includes("\t")) {
    const p = line.split(/\t/).map(s => s.trim());
    if (p[0] && p[1]) return { word: p[0], meaning: p[1], example: p[2] || "", exampleJa: p[3] || "", pos: "" };
  }
  // word - meaning (hyphen/en dash/em dash)
  const dashMatch = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dashMatch) return { word: dashMatch[1].trim(), meaning: dashMatch[2].trim(), example: "", exampleJa: "", pos: "" };
  // word: meaning
  const colonMatch = line.match(/^(.+?)\s*[:：]\s+(.+)$/);
  if (colonMatch) return { word: colonMatch[1].trim(), meaning: colonMatch[2].trim(), example: "", exampleJa: "", pos: "" };
  // English word + Japanese meaning (space-separated)
  const spaceMatch = line.match(/^([A-Za-z][A-Za-z0-9' .-]*?)\s+(.+)$/);
  if (spaceMatch) return { word: spaceMatch[1].trim(), meaning: spaceMatch[2].trim(), example: "", exampleJa: "", pos: "" };
  return null;
}

function parseImport(text, format) {
  text = (text || "").trim();
  if (!text) return [];
  let fmt = format;
  if (fmt === "auto") {
    if (/\n\s*\n/.test(text)) fmt = "block";
    else if (text.split(/\r?\n/).some(l => l.includes("\t"))) fmt = "tsv";
    else fmt = "line";
  }
  if (fmt === "tsv") {
    return text.split(/\r?\n/)
      .map(l => l.trim()).filter(Boolean)
      .map(l => {
        const p = l.split(/\t/).map(s => (s || "").trim());
        return { word: p[0] || "", meaning: p[1] || "", example: p[2] || "", exampleJa: p[3] || "", pos: "" };
      })
      .filter(w => w.word && w.meaning);
  }
  if (fmt === "block") {
    return text.split(/\r?\n\s*\r?\n/)
      .map(block => {
        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) {
          return lines.length === 1 ? parseImportLine(lines[0]) : null;
        }
        const word = lines[0];
        const meaning = lines[1];
        let example = "", exampleJa = "";
        if (lines[2]) {
          if (/^[A-Za-z]/.test(lines[2])) {
            example = lines[2];
            if (lines[3]) exampleJa = lines[3];
          } else {
            exampleJa = lines[2];
          }
        }
        return { word, meaning, example, exampleJa, pos: "" };
      })
      .filter(Boolean)
      .filter(w => w.word && w.meaning);
  }
  // line
  return text.split(/\r?\n/)
    .map(parseImportLine)
    .filter(Boolean);
}

previewImportBtn.addEventListener("click", () => {
  parsedImport = parseImport(importTextEl.value, importFormatEl.value);
  if (parsedImport.length === 0) {
    alert("解析できる単語がありませんでした。\n形式を変更するか、テキストの区切りを確認してください。");
    importPreview.hidden = true;
    return;
  }
  previewCount.textContent = parsedImport.length;
  previewListEl.innerHTML = "";
  const show = parsedImport.slice(0, 50);
  show.forEach(w => {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "info";
    const wd = document.createElement("div");
    wd.className = "w";
    wd.textContent = w.word;
    const md = document.createElement("div");
    md.className = "m";
    md.textContent = w.meaning + (w.example ? ` — ${w.example}` : "");
    info.appendChild(wd);
    info.appendChild(md);
    li.appendChild(info);
    previewListEl.appendChild(li);
  });
  if (parsedImport.length > 50) {
    const li = document.createElement("li");
    li.className = "empty-list";
    li.textContent = `... ほか ${parsedImport.length - 50} 件（全件取り込まれます）`;
    previewListEl.appendChild(li);
  }
  importPreview.hidden = false;
  importPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

confirmImportBtn.addEventListener("click", () => {
  if (parsedImport.length === 0) return;
  const dest = document.querySelector('input[name="importDest"]:checked').value;
  const items = parsedImport.map(w => ({ id: uid(), ...w }));
  if (dest === "mysample") {
    mySample = mySample.concat(items);
    saveMySample();
    renderMySampleList();
    alert(`⭐ マイサンプルに ${items.length}件 を取り込みました。`);
  } else {
    words = words.concat(items);
    saveWords();
    renderList();
    alert(`登録単語に ${items.length}件 を取り込みました。`);
  }
  importTextEl.value = "";
  parsedImport = [];
  importPreview.hidden = true;
});

cancelImportBtn.addEventListener("click", () => {
  parsedImport = [];
  importPreview.hidden = true;
});

/* OCR (Tesseract.js: lazy load from CDN) */
let tesseractPromise = null;
function loadTesseract() {
  if (!tesseractPromise) {
    tesseractPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => reject(new Error("Tesseract.jsの読み込みに失敗しました"));
      document.head.appendChild(s);
    });
  }
  return tesseractPromise;
}

ocrFile.addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  ocrStatus.hidden = false;
  ocrStatus.textContent = "ライブラリ読み込み中...";
  try {
    const Tesseract = await loadTesseract();
    ocrStatus.textContent = "OCR準備中...";
    const result = await Tesseract.recognize(file, "eng+jpn", {
      logger: m => {
        if (m.status && typeof m.progress === "number") {
          const pct = Math.round(m.progress * 100);
          const label = m.status === "recognizing text" ? "文字認識"
                      : m.status.startsWith("loading") ? "辞書読込"
                      : m.status;
          ocrStatus.textContent = `${label} ${pct}%`;
        }
      }
    });
    const text = (result && result.data && result.data.text) || "";
    ocrStatus.textContent = `✅ 読み取り完了: ${text.length}文字（下の貼り付け欄に挿入しました）`;
    document.querySelectorAll(".import-tab").forEach(t => t.classList.remove("active"));
    document.querySelector('.import-tab[data-method="paste"]').classList.add("active");
    document.getElementById("pasteMethod").hidden = false;
    document.getElementById("photoMethod").hidden = true;
    importTextEl.value = (importTextEl.value ? importTextEl.value + "\n\n" : "") + text;
    importTextEl.focus();
  } catch (err) {
    ocrStatus.textContent = "❌ OCRに失敗しました: " + err.message;
  }
  e.target.value = "";
});

/* ========== マイサンプル ========== */
const msForm = document.getElementById("msForm");
const msWord = document.getElementById("msWord");
const msPos = document.getElementById("msPos");
const msMeaning = document.getElementById("msMeaning");
const msExample = document.getElementById("msExample");
const msExampleJa = document.getElementById("msExampleJa");
const msSaveBtn = document.getElementById("msSaveBtn");
const msCancelBtn = document.getElementById("msCancelBtn");
const msListEl = document.getElementById("msList");
const msCount = document.getElementById("msCount");

msForm.addEventListener("submit", e => {
  e.preventDefault();
  const data = {
    word: msWord.value.trim(),
    pos: msPos.value.trim(),
    meaning: msMeaning.value.trim(),
    example: msExample.value.trim(),
    exampleJa: msExampleJa.value.trim(),
  };
  if (!data.word || !data.meaning) return;
  if (msEditingId) {
    const i = mySample.findIndex(w => w.id === msEditingId);
    if (i >= 0) mySample[i] = { ...mySample[i], ...data };
    msExitEdit();
  } else {
    mySample.push({ id: uid(), ...data });
  }
  saveMySample();
  msForm.reset();
  msWord.focus();
  renderMySampleList();
});

msCancelBtn.addEventListener("click", () => msExitEdit());

function msEnterEdit(id) {
  const w = mySample.find(x => x.id === id);
  if (!w) return;
  msEditingId = id;
  msSaveBtn.textContent = "更新する";
  msCancelBtn.hidden = false;
  msWord.value = w.word;
  msPos.value = w.pos || "";
  msMeaning.value = w.meaning;
  msExample.value = w.example || "";
  msExampleJa.value = w.exampleJa || "";
  msWord.focus();
  msForm.scrollIntoView({ behavior: "smooth", block: "center" });
}

function msExitEdit() {
  msEditingId = null;
  msSaveBtn.textContent = "マイサンプルに追加";
  msCancelBtn.hidden = true;
  msForm.reset();
}

function renderMySampleList() {
  msCount.textContent = mySample.length;
  msListEl.innerHTML = "";
  if (mySample.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-list";
    li.textContent = "マイサンプルはまだ空です";
    msListEl.appendChild(li);
    return;
  }
  mySample.forEach(w => {
    const li = document.createElement("li");
    const info = document.createElement("div");
    info.className = "info";
    const wd = document.createElement("div");
    wd.className = "w";
    wd.textContent = w.word;
    const md = document.createElement("div");
    md.className = "m";
    md.textContent = w.meaning;
    info.appendChild(wd);
    info.appendChild(md);

    const actions = document.createElement("div");
    actions.className = "actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "icon-btn";
    editBtn.textContent = "✏️";
    editBtn.title = "編集";
    editBtn.onclick = () => msEnterEdit(w.id);
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn";
    delBtn.textContent = "🗑";
    delBtn.title = "削除";
    delBtn.onclick = () => {
      if (!confirm(`マイサンプルから「${w.word}」を削除しますか？`)) return;
      mySample = mySample.filter(x => x.id !== w.id);
      saveMySample();
      renderMySampleList();
    };
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(info);
    li.appendChild(actions);
    msListEl.appendChild(li);
  });
}

document.getElementById("msExportBtn").addEventListener("click", () => {
  const data = mySample.map(({ id, ...rest }) => rest);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mysample_${level}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("msImportFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  try {
    let imported = [];
    if (file.name.endsWith(".json")) {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("配列形式ではありません");
      imported = parsed;
    } else if (file.name.endsWith(".csv")) {
      imported = parseCSV(text);
    }
    const normalized = imported
      .map(w => ({
        id: uid(),
        word: (w.word || "").trim(),
        pos: (w.pos || "").trim(),
        meaning: (w.meaning || "").trim(),
        example: (w.example || "").trim(),
        exampleJa: (w.exampleJa || "").trim(),
      }))
      .filter(w => w.word && w.meaning);
    if (normalized.length === 0) { alert("有効な単語が見つかりませんでした。"); return; }
    const replaceAll = confirm(
      `マイサンプルに${normalized.length}件読み込みます。\n「OK」→ 既存を置き換え\n「キャンセル」→ 追加する`
    );
    if (replaceAll) mySample = normalized;
    else mySample = mySample.concat(normalized);
    saveMySample();
    renderMySampleList();
    alert(`${normalized.length}件を読み込みました。`);
  } catch (err) {
    alert("ファイルの読み込みに失敗しました: " + err.message);
  }
  e.target.value = "";
});

document.getElementById("msClearBtn").addEventListener("click", () => {
  if (mySample.length === 0) { alert("マイサンプルはすでに空です。"); return; }
  if (!confirm(`マイサンプル ${mySample.length}件を全て削除します。元に戻せません。よろしいですか？`)) return;
  mySample = [];
  saveMySample();
  renderMySampleList();
});

/* ========== レベル切替 ========== */
const appTitle = document.getElementById("appTitle");

function applyLevelUI() {
  appTitle.textContent = LEVEL_TITLE[level];
  document.querySelectorAll(".level-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.level === level));
  document.title = LEVEL_TITLE[level] + " アプリ";
}

document.querySelectorAll(".level-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.dataset.level === level) return;
    synth && synth.cancel();
    card.classList.remove("flipped", "swipe-left", "swipe-right", "swipe-in-left", "swipe-in-right");
    speakBtn.classList.remove("speaking");
    speakBtnBack.classList.remove("speaking");
    level = btn.dataset.level;
    localStorage.setItem(LEVEL_KEY, level);
    words = loadWords();
    mySample = loadMySample();
    applyLevelUI();
    exitEditMode();
    msExitEdit();
    searchInput.value = "";
    resetStudy();
    renderList();
    renderMySampleList();
  });
});

/* ========== 初期化 ========== */
applyLevelUI();
resetStudy();
renderList();
renderMySampleList();
