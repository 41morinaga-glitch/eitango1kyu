const SPEAK_KEY = "eitango.speak.v1";
const MODE_KEY = "eitango.mode.v1";
const LEVEL_KEY = "eitango.level.v1";
const storageKeyFor = lv => `eitango.words.${lv}.v1`;
const mySampleKeyFor = lv => `eitango.mysample.${lv}.v1`;
const hiddenKeyFor = lv => `eitango.hidden.${lv}.v1`;

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
let hiddenIds = loadHidden();
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
  autoWriteShared();
}

function autoWriteShared() {
  if (!folderHandle) { setSyncStatus("idle"); return; }
  const data = mySample.map(({ id, ...rest }) => rest);
  const json = JSON.stringify(data, null, 2);
  setSyncStatus("saving");
  writeFolderFile(`shared_${level}.json`, json)
    .then(ok => setSyncStatus(ok ? "saved" : "need"))
    .catch(err => setSyncStatus("error", err && err.message));
}

function setSyncStatus(state, detail) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.className = "sync-status-line";
  if (state === "idle") { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  switch (state) {
    case "saving":
      el.classList.add("saving");
      el.textContent = "💾 書き込み中…";
      break;
    case "saved":
      el.classList.add("ok");
      el.textContent = `✅ shared_${level}.json に自動保存済み（Claudeに「プッシュして」で公開）`;
      break;
    case "need":
      el.classList.add("need");
      el.textContent = "⚠️ フォルダ権限が必要です → 「🔓 再承認」を押してください";
      showReapprove(true);
      break;
    case "error":
      el.classList.add("error");
      el.textContent = "❌ 書き込み失敗: " + (detail || "不明なエラー");
      break;
  }
}

function showReapprove(show) {
  const btn = document.getElementById("approveFolderBtn");
  if (btn) btn.hidden = !show;
}

/* ========== フォルダ連携（File System Access API） ========== */
let folderHandle = null;

const IDB_DB = "eitango-fs";
const IDB_STORE = "handles";

function idbOpen() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const r = tx.objectStore(IDB_STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function ensureFolderRW() {
  if (!folderHandle) return false;
  try {
    const opts = { mode: "readwrite" };
    let p = await folderHandle.queryPermission(opts);
    if (p === "granted") return true;
    p = await folderHandle.requestPermission(opts);
    return p === "granted";
  } catch (e) { return false; }
}

async function writeFolderFile(name, content) {
  if (!folderHandle) return false;
  const ok = await ensureFolderRW();
  if (!ok) return false;
  const fh = await folderHandle.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
  return true;
}

async function readFolderFile(name) {
  if (!folderHandle) return null;
  const ok = await ensureFolderRW();
  if (!ok) return null;
  try {
    const fh = await folderHandle.getFileHandle(name);
    const file = await fh.getFile();
    return await file.text();
  } catch (e) { return null; }
}

async function loadMySampleFromFolderIfEmpty() {
  if (!folderHandle || mySample.length > 0) return false;
  try {
    const perm = await folderHandle.queryPermission({ mode: "readwrite" });
    if (perm !== "granted") return false; // プロンプトは出さない
    const fh = await folderHandle.getFileHandle(`shared_${level}.json`).catch(() => null);
    if (!fh) return false;
    const file = await fh.getFile();
    const content = await file.text();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed) || parsed.length === 0) return false;
    mySample = parsed.map(w => ({ id: uid(), ...w }));
    localStorage.setItem(mySampleKeyFor(level), JSON.stringify(mySample));
    return true;
  } catch (e) {
    return false;
  }
}

function updateFolderStatus() {
  const wrap = document.getElementById("folderLink");
  const text = document.getElementById("folderStatusText");
  const hint = document.getElementById("folderHint");
  const linkBtn = document.getElementById("linkFolderBtn");
  const unlinkBtn = document.getElementById("unlinkFolderBtn");
  const syncBtn = document.getElementById("syncSharedBtn");
  if (folderHandle) {
    wrap.classList.add("linked");
    text.textContent = `✅ 連携中: ${folderHandle.name}`;
    hint.textContent = "マイサンプル変更時に shared_{level}.json に自動書込み";
    linkBtn.hidden = true;
    unlinkBtn.hidden = false;
    if (syncBtn) syncBtn.style.display = "none";
  } else {
    wrap.classList.remove("linked");
    text.textContent = "📁 フォルダ未連携（保存はブラウザ内のみ）";
    hint.textContent = "連携すると追加時に自動で shared_{level}.json に書込み（Chrome/Edge）";
    linkBtn.hidden = false;
    unlinkBtn.hidden = true;
    showReapprove(false);
    setSyncStatus("idle");
    if (syncBtn) syncBtn.style.display = "";
  }
}

document.getElementById("linkFolderBtn").addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    alert("このブラウザはフォルダ連携に対応していません。\nChrome または Edge 最新版でご利用ください。\n（Safari等では従来通りダウンロード方式で動作します）");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    folderHandle = handle;
    await idbSet("folder", handle);
    updateFolderStatus();
    // 既存の shared_{level}.json を読んで、ローカルより件数が多ければ取込を提案
    const content = await readFolderFile(`shared_${level}.json`);
    if (content) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > mySample.length) {
          const doLoad = confirm(
            `📁 フォルダの shared_${level}.json に ${parsed.length}件 あります（ローカルは ${mySample.length}件）。\n\n「OK」→ フォルダの内容で置き換える（推奨）\n「キャンセル」→ ローカルを維持して上書き`
          );
          if (doLoad) {
            mySample = parsed.map(w => ({ id: uid(), ...w }));
            localStorage.setItem(mySampleKeyFor(level), JSON.stringify(mySample));
          }
        }
      } catch (e) {}
    }
    renderMySampleList();
    autoWriteShared();
    alert(`✅ ${handle.name} と連携しました。\n以降の変更は自動保存されます。`);
  } catch (e) {
    if (e.name !== "AbortError") alert("連携に失敗しました: " + e.message);
  }
});

document.getElementById("approveFolderBtn").addEventListener("click", async () => {
  if (!folderHandle) return;
  try {
    const perm = await folderHandle.requestPermission({ mode: "readwrite" });
    if (perm === "granted") {
      showReapprove(false);
      autoWriteShared();
    } else {
      alert("権限が得られませんでした。もう一度お試しください。");
    }
  } catch (e) {
    alert("再承認に失敗しました: " + e.message);
  }
});

document.getElementById("unlinkFolderBtn").addEventListener("click", async () => {
  if (!confirm("フォルダ連携を解除します。\n（ローカル（ブラウザ内）のマイサンプルデータはそのまま残ります）")) return;
  folderHandle = null;
  await idbDel("folder");
  updateFolderStatus();
});

(async function restoreFolder() {
  try {
    const h = await idbGet("folder");
    if (!h) return;
    folderHandle = h;
    updateFolderStatus();
    try {
      const perm = await h.queryPermission({ mode: "readwrite" });
      if (perm === "granted") {
        setSyncStatus("saved");
        // ローカルが空ならフォルダの shared_{level}.json を取り込む
        if (mySample.length === 0) {
          const loaded = await loadMySampleFromFolderIfEmpty();
          if (loaded) renderMySampleList();
        }
      } else {
        setSyncStatus("need");
      }
    } catch (e) {
      setSyncStatus("need");
    }
  } catch (e) {}
})();

function loadHidden() {
  try {
    const raw = localStorage.getItem(hiddenKeyFor(level));
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
}

function saveHidden() {
  localStorage.setItem(hiddenKeyFor(level), JSON.stringify([...hiddenIds]));
}

function sampleFor(lv) {
  if (lv === "2kyu") return typeof WORDS_2KYU !== "undefined" ? WORDS_2KYU : [];
  return typeof WORDS_1KYU !== "undefined" ? WORDS_1KYU : [];
}

/* 共有サンプル（リポジトリ上の shared_{level}.json を全員が読み込む。書込はオーナーのみgit push）*/
const sharedData = { "1kyu": [], "2kyu": [] };
let sharedReady = false;

async function loadShared() {
  const levels = ["1kyu", "2kyu"];
  await Promise.all(levels.map(async lv => {
    try {
      const res = await fetch(`shared_${lv}.json?t=${Date.now()}`, { cache: "no-cache" });
      if (!res.ok) throw new Error("fetch failed");
      const data = await res.json();
      if (Array.isArray(data)) sharedData[lv] = data;
    } catch (e) {
      sharedData[lv] = [];
    }
  }));
  sharedReady = true;
  updateSharedBadge();
}

function updateSharedBadge() {
  const el = document.getElementById("sharedCount");
  if (!el) return;
  el.textContent = sharedReady ? sharedData[level].length : "読込中…";
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
    const v = tab.dataset.view;
    if (v === "study") resetStudy();
    else if (v === "manage") { renderList(); renderHiddenList(); }
    else if (v === "add") { renderMySampleList(); }
    window.scrollTo({ top: 0, behavior: "smooth" });
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

document.getElementById("hideBtn").addEventListener("click", e => {
  e.stopPropagation();
  hideCurrent();
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
  list = [...words].reverse().filter(w => !hiddenIds.has(w.id));
  index = 0;
  render();
}

function hideCurrent() {
  if (list.length === 0) return;
  const w = list[index];
  hiddenIds.add(w.id);
  saveHidden();
  list.splice(index, 1);
  if (index >= list.length) index = Math.max(0, list.length - 1);
  card.classList.add("swipe-down");
  setTimeout(() => {
    card.classList.remove("swipe-down");
    render();
    if (list.length > 0) {
      card.classList.add("swipe-in-top");
      setTimeout(() => card.classList.remove("swipe-in-top"), 280);
    }
    renderHiddenList();
  }, 240);
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
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  if (absDx > 60 && absDx > absDy * 1.5) {
    touchMoved = true;
    if (dx < 0) swipeNext();
    else swipePrev();
  } else if (absDy > 70 && absDy > absDx * 1.3 && dy > 0) {
    touchMoved = true;
    hideCurrent();
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
  const absDx = Math.abs(dx), absDy = Math.abs(dy);
  if (absDx > 60 && absDx > absDy * 1.5) {
    touchMoved = true;
    if (dx < 0) swipeNext();
    else swipePrev();
  } else if (absDy > 70 && absDy > absDx * 1.3 && dy > 0) {
    touchMoved = true;
    hideCurrent();
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
  const base = q
    ? words.filter(w =>
        w.word.toLowerCase().includes(q) ||
        (w.meaning || "").toLowerCase().includes(q))
    : words;
  const filtered = base.slice().reverse();

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
      if (hiddenIds.has(w.id)) { hiddenIds.delete(w.id); saveHidden(); }
      saveWords();
      renderList();
      renderHiddenList();
    };
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(info);
    li.appendChild(actions);
    wordList.appendChild(li);
  });
}

searchInput.addEventListener("input", renderList);

/* ========== 覚えた単語（非表示）リスト ========== */
const hiddenListEl = document.getElementById("hiddenList");
const hiddenCountEl = document.getElementById("hiddenCount");

function renderHiddenList() {
  hiddenCountEl.textContent = hiddenIds.size;
  hiddenListEl.innerHTML = "";
  const hiddenWords = words.filter(w => hiddenIds.has(w.id));
  if (hiddenWords.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-list";
    li.textContent = "覚えた単語はまだありません";
    hiddenListEl.appendChild(li);
    return;
  }
  hiddenWords.slice().reverse().forEach(w => {
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
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "btn btn-sub";
    restoreBtn.style.fontSize = "13px";
    restoreBtn.style.padding = "8px 12px";
    restoreBtn.textContent = "↺ 戻す";
    restoreBtn.onclick = () => {
      hiddenIds.delete(w.id);
      saveHidden();
      renderHiddenList();
    };
    actions.appendChild(restoreBtn);

    li.appendChild(info);
    li.appendChild(actions);
    hiddenListEl.appendChild(li);
  });
}

document.getElementById("unhideAllBtn").addEventListener("click", () => {
  if (hiddenIds.size === 0) { alert("非表示の単語はありません。"); return; }
  if (!confirm(`覚えた単語 ${hiddenIds.size}件 をすべて学習リストに戻します。よろしいですか？`)) return;
  hiddenIds = new Set();
  saveHidden();
  renderHiddenList();
});

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
  const shared = sharedData[level] || [];
  const myCount = mySample.length;
  const total = builtIn.length + shared.length + myCount;
  const parts = [`内蔵 ${builtIn.length}件`];
  if (shared.length) parts.push(`🌐 共有 ${shared.length}件`);
  if (myCount) parts.push(`⭐ マイ ${myCount}件`);
  const msg = `${lvName}のサンプル（${parts.join(" + ")} = 計${total}件）を既存データに追加します。よろしいですか？`;
  if (!confirm(msg)) return;
  const toAdd = [...builtIn, ...shared, ...mySample].map(w => ({
    id: uid(),
    word: w.word || "",
    pos: w.pos || "",
    meaning: w.meaning || "",
    example: w.example || "",
    exampleJa: w.exampleJa || "",
  })).filter(w => w.word && w.meaning);
  words = words.concat(toAdd);
  saveWords();
  renderList();
  alert(`${toAdd.length}件を追加しました。`);
});

document.getElementById("clearAllBtn").addEventListener("click", () => {
  if (!confirm("全ての単語を削除します。元に戻せません。本当によろしいですか？")) return;
  if (!confirm("本当に全て削除しますか？（最終確認）")) return;
  words = [];
  hiddenIds = new Set();
  saveWords();
  saveHidden();
  renderList();
  renderHiddenList();
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

function renderPreview() {
  previewCount.textContent = parsedImport.length;
  previewListEl.innerHTML = "";
  if (parsedImport.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-list";
    li.textContent = "解析できる単語がありません";
    previewListEl.appendChild(li);
    return;
  }
  parsedImport.forEach((w, idx) => {
    const li = document.createElement("li");
    li.className = "preview-row";

    const wInput = document.createElement("input");
    wInput.type = "text";
    wInput.className = "prev-word";
    wInput.value = w.word;
    wInput.placeholder = "単語";
    wInput.addEventListener("input", () => { parsedImport[idx].word = wInput.value; });

    const mInput = document.createElement("input");
    mInput.type = "text";
    mInput.className = "prev-meaning";
    mInput.value = w.meaning;
    mInput.placeholder = "意味";
    mInput.addEventListener("input", () => { parsedImport[idx].meaning = mInput.value; });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-btn";
    delBtn.textContent = "🗑";
    delBtn.title = "削除";
    delBtn.onclick = () => {
      parsedImport.splice(idx, 1);
      renderPreview();
    };

    li.appendChild(wInput);
    li.appendChild(mInput);
    li.appendChild(delBtn);
    previewListEl.appendChild(li);
  });
}

previewImportBtn.addEventListener("click", () => {
  parsedImport = parseImport(importTextEl.value, importFormatEl.value);
  if (parsedImport.length === 0) {
    alert("解析できる単語がありませんでした。\n形式を変更するか、テキストの区切りを確認してください。");
    importPreview.hidden = true;
    return;
  }
  renderPreview();
  importPreview.hidden = false;
  importPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

confirmImportBtn.addEventListener("click", () => {
  const valid = parsedImport.filter(w => (w.word || "").trim() && (w.meaning || "").trim());
  if (valid.length === 0) {
    alert("単語と意味の両方が入力されている行がありません。");
    return;
  }
  const dest = document.querySelector('input[name="importDest"]:checked').value;
  const items = valid.map(w => ({
    id: uid(),
    word: w.word.trim(),
    meaning: w.meaning.trim(),
    pos: (w.pos || "").trim(),
    example: (w.example || "").trim(),
    exampleJa: (w.exampleJa || "").trim(),
  }));
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

/* 画像前処理: グレースケール + コントラスト強調 + 拡大（OCR精度向上） */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("画像の読み込みに失敗"));
    img.src = URL.createObjectURL(file);
  });
}

async function preprocessImage(file) {
  const img = await loadImage(file);
  const maxDim = Math.max(img.width, img.height);
  const scale = maxDim < 1200 ? 2 : (maxDim < 1600 ? 1.4 : 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  // グレースケール + コントラスト強調 (係数1.6、中央値128)
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    let v = (gray - 128) * 1.6 + 128;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  ctx.putImageData(imageData, 0, 0);
  URL.revokeObjectURL(img.src);
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

ocrFile.addEventListener("change", async e => {
  const files = Array.from(e.target.files || []);
  if (files.length === 0) return;
  const lang = document.getElementById("ocrLang").value;
  const usePreprocess = document.getElementById("ocrPreprocess").checked;
  ocrStatus.hidden = false;
  ocrStatus.textContent = "ライブラリ読み込み中...";
  try {
    const Tesseract = await loadTesseract();
    let combined = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const prefix = files.length > 1 ? `[${i + 1}/${files.length}] ` : "";
      ocrStatus.textContent = `${prefix}画像処理中...`;
      const input = usePreprocess ? await preprocessImage(file) : file;
      const result = await Tesseract.recognize(input, lang, {
        logger: m => {
          if (m.status && typeof m.progress === "number") {
            const pct = Math.round(m.progress * 100);
            const label = m.status === "recognizing text" ? "文字認識"
                        : m.status.startsWith("loading") ? "辞書読込"
                        : m.status.startsWith("initializing") ? "初期化"
                        : m.status;
            ocrStatus.textContent = `${prefix}${label} ${pct}%`;
          }
        }
      });
      const text = (result && result.data && result.data.text) || "";
      combined += (combined ? "\n\n" : "") + text;
    }
    ocrStatus.textContent = `✅ 読取完了 (${files.length}枚, ${combined.length}文字)`;

    // テキスト欄に反映して自動プレビュー
    document.querySelectorAll(".import-tab").forEach(t => t.classList.remove("active"));
    document.querySelector('.import-tab[data-method="paste"]').classList.add("active");
    document.getElementById("pasteMethod").hidden = false;
    document.getElementById("photoMethod").hidden = true;
    importTextEl.value = (importTextEl.value ? importTextEl.value + "\n\n" : "") + combined;
    parsedImport = parseImport(importTextEl.value, importFormatEl.value);
    if (parsedImport.length > 0) {
      renderPreview();
      importPreview.hidden = false;
      importPreview.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      importTextEl.focus();
      alert("OCRは完了しましたが、単語として解析できませんでした。\nテキストを確認・編集して「プレビュー」を押してください。");
    }
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

document.getElementById("syncSharedBtn").addEventListener("click", async () => {
  if (mySample.length === 0) {
    alert("マイサンプルが空です。まず単語を追加してください。");
    return;
  }
  const data = mySample.map(({ id, ...rest }) => rest);
  const json = JSON.stringify(data, null, 2);

  if (folderHandle) {
    if (!confirm(`📁 連携フォルダ「${folderHandle.name}」内の shared_${level}.json を上書きします。\n\n${mySample.length}件を反映。続けますか？\n\n（書き込み後、Claudeに「プッシュして」と伝えれば反映完了）`)) return;
    const ok = await writeFolderFile(`shared_${level}.json`, json);
    if (ok) {
      alert(`✅ shared_${level}.json に書き込みました。\nChaude に「プッシュして」とお伝えください。`);
    } else {
      alert("❌ 書き込みに失敗しました。権限またはフォルダを確認してください。");
    }
    return;
  }

  // フォルダ未連携 → 従来のダウンロード
  if (!confirm(
    `現在のマイサンプル ${mySample.length}件 を共有ファイル shared_${level}.json としてダウンロードします。\n\nダウンロード後、このファイルをリポジトリの shared_${level}.json と置き換えて git push してください。`
  )) return;
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `shared_${level}.json`;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
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
  btn.addEventListener("click", async () => {
    if (btn.dataset.level === level) return;
    synth && synth.cancel();
    card.classList.remove("flipped", "swipe-left", "swipe-right", "swipe-in-left", "swipe-in-right");
    speakBtn.classList.remove("speaking");
    speakBtnBack.classList.remove("speaking");
    level = btn.dataset.level;
    localStorage.setItem(LEVEL_KEY, level);
    words = loadWords();
    mySample = loadMySample();
    hiddenIds = loadHidden();
    applyLevelUI();
    exitEditMode();
    msExitEdit();
    searchInput.value = "";
    resetStudy();
    renderList();
    renderMySampleList();
    renderHiddenList();
    updateSharedBadge();
    // フォルダ連携中 & ローカルが空 → フォルダから読み込み（書込はしない）
    if (folderHandle && mySample.length === 0) {
      const loaded = await loadMySampleFromFolderIfEmpty();
      if (loaded) renderMySampleList();
    }
    // ステータス更新だけ（書込は trigger しない）
    if (folderHandle) {
      try {
        const perm = await folderHandle.queryPermission({ mode: "readwrite" });
        setSyncStatus(perm === "granted" ? "saved" : "need");
      } catch (e) {}
    }
  });
});

/* ========== 初期化 ========== */
applyLevelUI();
resetStudy();
renderList();
renderMySampleList();
renderHiddenList();
loadShared();
