const STORAGE_KEY = "eitango1kyu.words.v1";
const SPEAK_KEY = "eitango1kyu.speak.v1";
const MODE_KEY = "eitango1kyu.mode.v1";

let words = loadWords();
let list = [];
let index = 0;
let editingId = null;
let autoSpeak = localStorage.getItem(SPEAK_KEY) === "1";
let mode = localStorage.getItem(MODE_KEY) === "jaen" ? "jaen" : "enja";

function loadWords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

function saveWords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(words));
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ========== 発音（Web Speech API） ========== */
const synth = window.speechSynthesis;
let enVoice = null;

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices.length) return;
  enVoice =
    voices.find(v => v.lang === "en-US" && /Samantha|Alex|Ava|Karen|Daniel/i.test(v.name)) ||
    voices.find(v => v.lang === "en-US") ||
    voices.find(v => v.lang && v.lang.startsWith("en")) ||
    voices[0];
}
if (synth) {
  pickVoice();
  synth.addEventListener("voiceschanged", pickVoice);
}

function speak(text, opts = {}) {
  if (!synth || !text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US";
  if (enVoice) u.voice = enVoice;
  u.rate = opts.rate || 0.95;
  u.pitch = 1;
  if (opts.onstart) u.onstart = opts.onstart;
  if (opts.onend) u.onend = opts.onend;
  synth.speak(u);
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
  a.download = `eitango1kyu_${new Date().toISOString().slice(0, 10)}.json`;
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

    const mode = confirm(
      `${normalized.length}件の単語を読み込みます。\n\n「OK」→ 既存データに追加\n「キャンセル」→ 何もしない`
    );
    if (!mode) { e.target.value = ""; return; }

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
  if (!confirm("サンプル単語を既存データに追加します。よろしいですか？")) return;
  const sample = (typeof WORDS !== "undefined" ? WORDS : []).map(w => ({ id: uid(), ...w }));
  words = words.concat(sample);
  saveWords();
  renderList();
  alert(`サンプル ${sample.length}件を追加しました。`);
});

document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (!confirm("全ての単語を削除します。元に戻せません。本当によろしいですか？")) return;
  if (!confirm("本当に全て削除しますか？（最終確認）")) return;
  words = [];
  saveWords();
  renderList();
});

/* ========== 初期化 ========== */
resetStudy();
renderList();
