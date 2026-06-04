// Service worker — перевод субтитров + перевод отдельных слов

const cache = new Map();

async function translateSentence(text) {
  const key = 's|' + text;
  if (cache.has(key)) return cache.get(key);

  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=auto&tl=ru&dt=t&q=${encodeURIComponent(text)}`;
  const data = await fetch(url).then(r => r.json());
  const chunks = (data[0] || []).filter(c => c && c[0]);
  const result = { chunks, detectedLang: data[2] || 'auto' };
  cache.set(key, result);
  return result;
}

async function translateWord(word) {
  const key = 'w|' + word.toLowerCase();
  if (cache.has(key)) return cache.get(key);

  // dt=t  → перевод слова
  // dt=bd → словарные статьи (там бывают устойчивые выражения)
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=ru&tl=en&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
  const data = await fetch(url).then(r => r.json());

  // Основной перевод слова
  const translation = (data[0] || []).map(c => c[0]).join('').trim();

  // Ищем многословные выражения в словарных статьях
  const phrases = [];
  for (const [, entries] of (data[1] || [])) {
    for (const [term] of (entries || [])) {
      const t = (term || '').trim();
      if (t.includes(' ') && phrases.length < 2) phrases.push(t);
    }
  }

  const result = { translation, phrases };
  cache.set(key, result);
  return result;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = async () => {
    if (msg.type === 'translate')     return translateSentence(msg.text);
    if (msg.type === 'translateWord') return translateWord(msg.word);
    return {};
  };
  handle().then(sendResponse).catch(() => sendResponse({}));
  return true;
});
