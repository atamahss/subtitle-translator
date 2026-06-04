// ══════════════════════════════════════════════════════════════════════════════
// Subtitle Translator — content script
// ══════════════════════════════════════════════════════════════════════════════

// ─── Safe messaging ───────────────────────────────────────────────────────────
function safeSend(msg, cb) {
  try {
    if (!chrome.runtime?.id) return;
    chrome.runtime.sendMessage(msg, res => {
      if (chrome.runtime.lastError) return;
      cb && cb(res);
    });
  } catch (_) {}
}

// ─── State ────────────────────────────────────────────────────────────────────
let activeVideo    = null;
let activeJwRoot   = null;
let subWatcher     = null;
let currentText    = '';
let translateTimer = null;
let posRafId       = null;

// ─── Bottom Bar ───────────────────────────────────────────────────────────────
const bar = document.createElement('div');
bar.id = 'st-bar';
bar.style.display = 'none';

const barInner = document.createElement('div');
barInner.id = 'st-bar-inner';
bar.appendChild(barInner);

const appendBar = () => (document.body || document.documentElement).appendChild(bar);
if (document.body) appendBar();
else document.addEventListener('DOMContentLoaded', appendBar);

// ─── Word Tooltip ─────────────────────────────────────────────────────────────
const wordTip = document.createElement('div');
wordTip.id = 'st-word-tip';
const appendTip = () => (document.body || document.documentElement).appendChild(wordTip);
if (document.body) appendTip();
else document.addEventListener('DOMContentLoaded', appendTip);

let mx = 0, my = 0;
document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  moveWordTip();
}, { passive: true });

function moveWordTip() {
  if (!wordTip.dataset.visible) return;
  // Показываем тултип левее и чуть выше курсора
  const g = 12, w = wordTip.offsetWidth, h = wordTip.offsetHeight;
  let x = mx - w - g;          // по умолчанию — слева от курсора
  let y = my - h / 2;          // вертикально по центру
  if (x < 8) x = mx + g;       // не влезает слева — переходим вправо
  if (y < 8) y = 8;
  if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
  wordTip.style.transform = `translate(${x}px,${y}px)`;
}

// Показывает: перевод слова слева, устойчивое выражение справа (если есть)
function showWordTip(translation, phrases) {
  let html = `<span class="wt-word">${esc(translation)}</span>`;
  if (phrases.length) {
    html += `<span class="wt-sep"></span>`;
    html += `<span class="wt-phrase">${esc(phrases[0])}</span>`;
  }
  wordTip.innerHTML = html;
  wordTip.dataset.visible = '1';
  moveWordTip();
}

function hideWordTip() {
  delete wordTip.dataset.visible;
  wordTip.innerHTML = '';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Render translation bar ───────────────────────────────────────────────────
function renderBar(chunks) {
  barInner.innerHTML = '';

  for (const chunk of chunks) {
    const [translated] = chunk;
    if (!translated) continue;

    const tokens = translated.match(/[\p{L}\p{N}'''\-]+|[^\p{L}\p{N}'''\-]+/gu) || [];

    for (const token of tokens) {
      if (!/[\p{L}\p{N}]/u.test(token)) {
        barInner.appendChild(document.createTextNode(token));
        continue;
      }

      const span = document.createElement('span');
      span.className = 'st-word';
      span.textContent = token;

      // На ховер — запрашиваем перевод слова + фразы
      span.addEventListener('mouseenter', () => {
        const clean = token.replace(/[^\p{L}\p{N}'\-]/gu, '');
        if (!clean) return;
        safeSend({ type: 'translateWord', word: clean }, res => {
          if (!res?.translation) return;
          showWordTip(res.translation, res.phrases || []);
        });
      });
      span.addEventListener('mouseleave', hideWordTip);

      barInner.appendChild(span);
    }
  }

  bar.style.display = 'flex';
}

function clearBar() {
  currentText = '';
  barInner.innerHTML = '';
  bar.style.display = 'none';
}

// ─── Translation ──────────────────────────────────────────────────────────────
function translateAndRender(text) {
  if (text === currentText) return;
  currentText = text;
  clearTimeout(translateTimer);
  translateTimer = setTimeout(() => {
    safeSend({ type: 'translate', text }, res => {
      if (res?.chunks?.length) renderBar(res.chunks);
    });
  }, 80);
}

// ─── Caption detection ────────────────────────────────────────────────────────
// Контейнеры идут первыми — они стабильны.
// .jw-captions-text — нестабилен: JW пересоздаёт его при каждом субтитре,
// поэтому Observer на нём умирает. Смотрим родительский контейнер.
const CAPTION_SELS = [
  '.jw-captions',
  '.jw-captions-window',
  '.jw-text-track-cue',
  '.jw-caption-frame',
  '.jw-captions-text',    // крайний случай — нестабильный
];

function findCaptions(root) {
  for (const sel of CAPTION_SELS) {
    const el = root.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function findPlayerRoot(videoEl) {
  let el = videoEl?.parentElement;
  while (el && el !== document.documentElement) {
    // Явные JW-классы
    if (el.matches('.jwplayer, .jw-wrapper, .jw-fluid, [id^="jwplayer"]')) return el;
    // Любой предок, внутри которого уже есть JW-субтитры
    if (el.querySelector('.jw-captions, .jw-captions-text, .jw-text-track-cue')) return el;
    el = el.parentElement;
  }
  // Fallback: ближайший родитель video (не сам video!)
  return videoEl?.parentElement || null;
}

// Копируем шрифт с субтитрного элемента чтобы бар выглядел в одном стиле
function matchSubtitleFont(capEl) {
  try {
    const cs = window.getComputedStyle(capEl);
    if (cs.fontFamily) barInner.style.fontFamily = cs.fontFamily;
    if (cs.fontWeight) barInner.style.fontWeight = cs.fontWeight;
  } catch (_) {}
}

function watchCaptions(capEl) {
  if (subWatcher) subWatcher.disconnect();

  matchSubtitleFont(capEl);

  const read = () => {
    const t = capEl.textContent.trim();
    if (t) translateAndRender(t);
    else clearBar();
  };

  read();
  subWatcher = new MutationObserver(() => {
    // Если элемент вышел из DOM (JW пересоздал его) — ищем заново
    if (!document.contains(capEl) && activeJwRoot) {
      const fresh = findCaptions(activeJwRoot);
      if (fresh && fresh !== capEl) { watchCaptions(fresh); return; }
    }
    read();
  });
  subWatcher.observe(capEl, { childList: true, characterData: true, subtree: true });
}

// ─── Bar positioning — RAF loop ───────────────────────────────────────────────
function startPositionLoop(root) {
  if (posRafId) cancelAnimationFrame(posRafId);
  function loop() {
    const r = root.getBoundingClientRect();
    bar.style.left   = r.left   + 'px';
    bar.style.width  = r.width  + 'px';
    bar.style.right  = 'auto';
    bar.style.top    = r.bottom + 'px';
    bar.style.bottom = 'auto';
    posRafId = requestAnimationFrame(loop);
  }
  posRafId = requestAnimationFrame(loop);
}

// ─── Multi-video tracking ─────────────────────────────────────────────────────
function activateVideo(videoEl) {
  if (activeVideo === videoEl) return;
  activeVideo = videoEl;

  const root = findPlayerRoot(videoEl);
  if (!root) return;

  activeJwRoot = root;
  startPositionLoop(root);

  const cap = findCaptions(root);
  if (cap) { watchCaptions(cap); return; }

  const waitObs = new MutationObserver(() => {
    const c = findCaptions(root);
    if (c) { waitObs.disconnect(); watchCaptions(c); }
  });
  waitObs.observe(root, { childList: true, subtree: true });
}

function trackVideo(v) {
  if (v.dataset.stTracked) return;
  v.dataset.stTracked = '1';
  v.addEventListener('play', () => activateVideo(v));
  if (!v.paused) activateVideo(v);
}

const pageObs = new MutationObserver(() =>
  document.querySelectorAll('video').forEach(trackVideo)
);
pageObs.observe(document.documentElement, { childList: true, subtree: true });
document.querySelectorAll('video').forEach(trackVideo);
