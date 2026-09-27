/* MediQuiz — front end. Vanilla JS, offline-first, every popup minimizable. */
'use strict';

/* ============================ tiny helpers ============================ */
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9+\s]/g, ' ').replace(/\s+/g, ' ').trim();
const rupee = r => { if (!r) return null; r = String(r); return r.startsWith('₹') ? r : (/^\d/.test(r) ? '₹' + r : r); };

/* ============================ sound (webaudio synth) ============================ */
const Sound = {
  on: JSON.parse(localStorage.getItem('mq.sound') ?? 'true'),
  ctx: null,
  beep(freq, dur, type = 'sine', vol = .18, when = 0) {
    if (!this.on) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const t = this.ctx.currentTime + when;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + .02);
    } catch (e) {}
  },
  click() { this.beep(700, .06, 'triangle', .12); },
  open()  { this.beep(520, .07, 'sine', .1); this.beep(780, .08, 'sine', .08, .05); },
  good()  { this.beep(523, .1, 'triangle'); this.beep(659, .1, 'triangle', .18, .09); this.beep(784, .16, 'triangle', .2, .18); },
  bad()   { this.beep(220, .2, 'sawtooth', .12); this.beep(160, .28, 'sawtooth', .1, .12); },
  win()   { [523, 659, 784, 1047].forEach((f, i) => this.beep(f, .18, 'triangle', .16, i * .12)); },
  tick()  { this.beep(880, .05, 'square', .05); }
};
function buzz(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

/* ============================ toast ============================ */
let toastT = null;
function toast(msg, ms = 1900) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ============================ overlay stack ============================
   Every popup is a bottom "sheet" with:
     —  = minimise into a floating pill (tap pill to bring back)
     ✕  = close completely
   DOM nodes are kept alive when minimised (listeners + scroll intact).   */
const Overlays = {
  act: [],               // visible stack
  min: new Map(),        // id -> {id,title,node,pill,onClose}
  open(id, title, bodyNode, opts = {}) {
    if (this.act.some(o => o.id === id)) this.close(id);
    const pill = this.min.get(id)?.pill; if (pill) { pill.remove(); this.min.delete(id); }
    const sheet = document.createElement('section');
    sheet.className = 'sheet'; sheet.dataset.oid = id;
    sheet.innerHTML = `<header class="sheet-head">
        <div class="sheet-title">${esc(title)}</div>
        <button class="hbtn" data-mini aria-label="Minimise" title="Minimise">—</button>
        <button class="hbtn" data-close aria-label="Close" title="Close">✕</button>
      </header>`;
    sheet.appendChild(bodyNode);
    sheet.querySelector('[data-mini]').onclick = e => { e.stopPropagation(); this.minimize(id); };
    sheet.querySelector('[data-close]').onclick = e => { e.stopPropagation(); this.close(id); };
    $('#overlayStack').appendChild(sheet);
    this.act.push({ id, title, node: sheet, onClose: opts.onClose || null, fullClose: opts.fullClose !== false });
    $('#overlayBack').classList.remove('hidden');
    Sound.open();
    return sheet;
  },
  get top() { return this.act[this.act.length - 1]; },
  close(id) {
    const i = this.act.findIndex(o => o.id === id);
    if (i >= 0) { const [o] = this.act.splice(i, 1); o.node.remove(); o.onClose && o.onClose(); }
    const mn = this.min.get(id);
    if (mn) { mn.pill.remove(); mn.node.remove(); this.min.delete(id); mn.onClose && mn.onClose(); }
    this.sync();
  },
  minimize(id) {
    const i = this.act.findIndex(o => o.id === id);
    if (i < 0) return;
    const [o] = this.act.splice(i, 1);
    o.node.remove();                       // detached — kept alive with listeners
    const pill = document.createElement('button');
    pill.className = 'mini-pill';
    pill.innerHTML = `${esc(o.title.slice(0, 24))} <span class="x" title="Close">✕</span>`;
    pill.onclick = () => this.restore(id);
    pill.querySelector('.x').onclick = e => { e.stopPropagation(); this.close(id); };
    $('#miniDock').appendChild(pill);
    this.min.set(id, { id, title: o.title, node: o.node, pill, onClose: o.onClose });
    buzz(10);
    this.sync();
  },
  restore(id) {
    const mn = this.min.get(id);
    if (!mn) return;
    mn.pill.remove(); this.min.delete(id);
    $('#overlayStack').appendChild(mn.node);
    this.act.push({ id, title: mn.title, node: mn.node, onClose: mn.onClose, fullClose: true });
    this.sync();
    Sound.open();
  },
  sync() {
    $('#overlayBack').classList.toggle('hidden', this.act.length === 0);
    $('#miniDock').classList.toggle('hidden', this.min.size === 0);
  }
};

/* ============================ data ============================ */
let DB = null, groups = new Map(), byId = new Map(), tokenIdx = new Map(), molIdx = new Map();

function indexData(items) {
  DB = items;
  groups = new Map(); byId = new Map(); tokenIdx = new Map(); molIdx = new Map();
  for (const m of items) {
    byId.set(m.id, m);
    if (!groups.has(m.ingredientKey)) groups.set(m.ingredientKey, []);
    groups.get(m.ingredientKey).push(m);
    for (const t of norm(m.name).split(' ')) {
      if (t.length < 2) continue;
      if (!tokenIdx.has(t)) tokenIdx.set(t, []);
      tokenIdx.get(t).push(m.id);
    }
    for (const mol of (m.molecules || [])) {
      const k = mol.toLowerCase();
      if (!molIdx.has(k)) molIdx.set(k, new Set());
      molIdx.get(k).add(m.ingredientKey);
    }
  }
}

function searchLocal(q) {
  const toks = norm(q).split(' ').filter(Boolean);
  if (q.trim().length < 2 || !toks.length) return { salts: [], brands: [] };
  let hits = null;
  for (const t of toks) {
    const bucket = new Set();
    for (const [tok, ids] of tokenIdx) if (tok.startsWith(t)) ids.forEach(id => bucket.add(id));
    hits = hits === null ? bucket : new Set([...hits].filter(id => bucket.has(id)));
    if (!hits.size) break;
  }
  const brands = [...(hits || [])].map(id => byId.get(id));
  const saltKeys = new Set();
  for (const [mk, keys] of molIdx) if (toks.every(t => mk.includes(t))) keys.forEach(k => saltKeys.add(k));
  return { salts: [...saltKeys], brands };
}

/* ============================ boot ============================ */
async function boot() {
  // standalone single-file builds embed the catalog; otherwise fetch relative
  let items = window.MQ_EMBED_DATA || null;
  for (const attempt of ['fetch', 'fetch-cache']) {
    if (items) break;
    try {
      const r = await fetch('data/medicines.json', attempt === 'fetch-cache' ? { cache: 'force-cache' } : {});
      if (r.ok) items = await r.json();
    } catch (e) {}
  }
  if (!items) { $('#splashErr').classList.remove('hide'); return; }
  indexData(items);
  $('#splash').classList.add('done');
  setTimeout(() => { const sp = $('#splash'); sp && sp.remove(); }, 450);
  $('#app').classList.remove('hidden');
  buildQuickChips();
  fillAbout();
  $('#aboutLine').textContent =
    `${DB.length.toLocaleString()} items from the shop stock file · ` +
    `${DB.filter(m => !m.nonDrug).length.toLocaleString()} in the game pool · works offline`;
  updateBestLine();
}

/* ============================ navigation ============================ */
$$('.nav-btn').forEach(b => b.addEventListener('click', () => {
  Sound.click();
  $$('.nav-btn').forEach(x => x.classList.toggle('on', x === b));
  ['search', 'salts', 'play', 'more'].forEach(p => $('#page-' + p).classList.toggle('hidden', p !== b.dataset.page));
  if (b.dataset.page === 'salts') renderSalts($('#saltFilter').value);
  if (b.dataset.page === 'more') renderStats();
  if (b.dataset.page === 'play') updateBestLine();
}));

/* ============================ search ============================ */
function buildQuickChips() {
  const qc = ['amox', 'pantoprazole', 'para', 'cef', 'zerodol', 'digene', 'calcium', 'zinc'];
  $('#quickChips').innerHTML = qc.map(c => `<button class="qchip" data-q="${c}">${c}…</button>`).join('');
  $$('#quickChips .qchip').forEach(b => b.onclick = () => { $('#searchInput').value = b.dataset.q; doSearch(b.dataset.q); });
}

let searchTimer = null;
(function initSearch() {
  const inp = $('#searchInput');
  inp.addEventListener('input', () => {
    $('#clearSearch').classList.toggle('hidden', !inp.value);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(inp.value), 110);
  });
  inp.addEventListener('focus', () => { if (inp.value.trim().length >= 2) doSearch(inp.value); });
  $('#clearSearch').onclick = () => { inp.value = ''; doSearch(''); inp.focus(); };
  document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) $('#suggest').classList.add('hidden'); });
})();

function resultCard(m) {
  const rate = rupee(m.rate);
  const badges = [];
  if (m.formulation) badges.push(`<span class="tag">${esc(m.formulation)}</span>`);
  if (m.strength) badges.push(`<span class="tag">${esc(String(m.strength).slice(0, 34))}</span>`);
  if (m.nonDrug) badges.push(`<span class="tag nd">non-drug</span>`);
  if ((m.source || '').toLowerCase().includes('web-verified')) badges.push(`<span class="tag shot">✔ verified</span>`);
  return `<article class="result-card" data-id="${m.id}">
    <div class="r-top"><div class="r-name">${esc(m.name)}</div>${rate ? `<div class="r-rate">${esc(rate)}</div>` : ''}</div>
    <div class="r-ing">${esc(m.ingredient)}</div>
    <div class="r-tags">${badges.join('')}</div>
  </article>`;
}

function doSearch(qRaw) {
  const q = qRaw.trim();
  if (!DB) return;
  if (q.length < 2) {
    $('#homeEmpty').classList.remove('hidden');
    $('#searchResults').innerHTML = ''; $('#searchMeta').textContent = '';
    $('#suggest').classList.add('hidden'); return;
  }
  $('#homeEmpty').classList.add('hidden');
  const r = searchLocal(q);
  const saltTop = r.salts.slice(0, 6).map(k => ({ key: k, display: groups.get(k)[0].ingredient, count: groups.get(k).length }));
  const brandTop = r.brands.slice(0, 10);
  // dropdown
  let html = '';
  if (saltTop.length) html += `<div class="sg-head">🧂 Salts / ingredients</div>` + saltTop.map(s =>
    `<div class="sg-item" data-salt="${esc(s.key)}"><div><div class="sg-main">${esc(s.display.slice(0, 80))}${s.display.length > 80 ? '…' : ''}</div></div>
     <span class="sg-count">${s.count} brand${s.count > 1 ? 's' : ''}</span></div>`).join('');
  if (brandTop.length) html += `<div class="sg-head">💊 Brands</div>` + brandTop.map(m =>
    `<div class="sg-item" data-id="${m.id}"><div><div class="sg-main">${esc(m.name)}</div>
     <div class="sg-sub">${esc(m.ingredient.slice(0, 75))}</div></div>${rupee(m.rate) ? `<span class="sg-count">${esc(rupee(m.rate))}</span>` : ''}</div>`).join('');
  if (html) {
    $('#suggest').innerHTML = html;
    $('#suggest').classList.remove('hidden');
    $$('#suggest .sg-item[data-id]').forEach(el => el.onclick = () => { $('#suggest').classList.add('hidden'); openMedicine(+el.dataset.id); });
    $$('#suggest .sg-item[data-salt]').forEach(el => el.onclick = () => { $('#suggest').classList.add('hidden'); openSaltGroup(el.dataset.salt); });
  } else $('#suggest').classList.add('hidden');
  // results list
  const full = r.brands.slice(0, 60);
  $('#searchMeta').textContent = `${r.brands.length} brand${r.brands.length === 1 ? '' : 's'} · ${r.salts.length} salt${r.salts.length === 1 ? '' : 's'} match “${q}”`;
  $('#searchResults').innerHTML = full.length ? full.map(resultCard).join('')
    : `<div class="empty-state" style="padding:28px"><div class="big-pulse">🕵️</div><p>Nothing matches “${esc(q)}”.<br>Try fewer letters — e.g. “amox clav”.</p></div>`;
  $$('#searchResults .result-card').forEach(el => el.onclick = () => openMedicine(+el.dataset.id));
}

/* ============================ detail sheet ============================ */
function detailHTML(m) {
  const v = (label, val) => val ? `<div class="k">${label}</div><div class="v">${val}</div>` : '';
  const srcBadge = (m.source || '').toLowerCase().includes('web-verified')
    ? `<span class="src-badge">✔ web-verified composition</span>`
    : `<span class="src-badge gray">${esc(m.source || 'stock file')}</span>`;
  return `<div class="detail-hero">
      <div class="detail-name">${esc(m.name)}<small>${esc(m.category)}</small></div>
    </div>
    ${srcBadge}
    <div class="detail-grid">
      ${v('🧂 Ingredients', esc(m.ingredient))}
      ${v('📦 Form', esc(m.formulation))}
      ${v('💪 Strength', esc(m.strength))}
      ${v('🕐 Usual dose', esc(m.dose))}
      ${v('📝 Note', esc(m.note))}
      ${v('💰 Sale rate', esc(rupee(m.rate)))}
    </div>`;
}

function openMedicine(id) {
  Sound.click(); buzz(6);
  const m = byId.get(id); if (!m) return;
  const body = document.createElement('div');
  body.className = 'sheet-body';
  const mates = (groups.get(m.ingredientKey) || []).filter(x => x.id !== m.id);
  body.innerHTML = detailHTML(m) + `
    ${mates.length ? `<div class="k" style="color:var(--dim);font-weight:600;font-size:.8rem">Same composition (${mates.length})</div>
      <div class="same-chips">${mates.slice(0, 24).map(x => `<button class="same-chip" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : ''}
    <div class="detail-actions">
      ${m.nonDrug ? '' : `<button class="btn primary" id="dtQuiz">🎯 Quiz me on this</button>`}
      <button class="btn ghost" id="dtSalt">🧂 Salt family</button>
    </div>`;
  body.querySelectorAll('.same-chip').forEach(b => b.onclick = () => { openMedicine(+b.dataset.id); });
  const qBtn = body.querySelector('#dtQuiz');
  if (qBtn) qBtn.onclick = () => { Overlays.close(`med-${id}`); startGame('brand2ing', 5, 4, 20, m); };
  body.querySelector('#dtSalt').onclick = () => openSaltGroup(m.ingredientKey);
  Overlays.open(`med-${id}`, m.name, body);
}

function openSaltGroup(key) {
  const list = groups.get(key) || [];
  const display = list[0] ? list[0].ingredient : key;
  const body = document.createElement('div');
  body.className = 'sheet-body';
  body.innerHTML = `<div class="detail-name" style="font-size:1.12rem;line-height:1.35">${esc(display)}</div>
    <div class="q-sub">${list.length} brand${list.length > 1 ? 's' : ''} in stock</div>
    <div style="margin-top:12px">${list.map(resultCard).join('')}</div>`;
  body.querySelectorAll('.result-card').forEach(el => el.onclick = () => openMedicine(+el.dataset.id));
  Overlays.open(`salt-${key}`, '🧂 Salt family', body);
}

/* ============================ salt browser ============================ */
$('#saltFilter').addEventListener('input', () => renderSalts($('#saltFilter').value));
function renderSalts(filter = '') {
  if (!DB) return;
  const entries = [...groups.entries()].filter(([, list]) => !list[0].nonDrug)
    .sort((a, b) => a[1][0].ingredient.localeCompare(b[1][0].ingredient));
  const f = norm(filter);
  const shown = f ? entries.filter(([, list]) => list[0].ingredient.toLowerCase().includes(f)) : entries;
  $('#saltList').innerHTML = shown.slice(0, 400).map(([k, list]) =>
    `<div class="salt-item" data-key="${esc(k)}"><div class="salt-name">${esc(list[0].ingredient.length > 72 ? list[0].ingredient.slice(0, 72) + '…' : list[0].ingredient)}</div>
     <div class="salt-n">${list.length} ×</div></div>`).join('') || `<div class="empty-state"><p>No salt matches.</p></div>`;
  $$('#saltList .salt-item').forEach(el => el.onclick = () => openSaltGroup(el.dataset.key));
}

/* ============================ GAME ============================ */
const G = {
  active: false, mode: 'brand2ing', count: 10, nOpts: 4, timer: 20,
  qs: [], i: 0, score: 0, streak: 0, bestStreak: 0, fifty: 2,
  answers: [], tHandle: null, tLeft: 0, locked: false, only: null
};
const stats = () => { try { return JSON.parse(localStorage.getItem('mq.stats')) || {}; } catch (e) { return {}; } };
const loadStats = () => ({ games: 0, best: {}, correct: 0, total: 0, maxStreak: 0, ...stats() });
const saveStats = s => localStorage.setItem('mq.stats', JSON.stringify(s));

$$('#modeSeg button').forEach(b => b.onclick = () => {
  $$('#modeSeg button').forEach(x => x.classList.toggle('on', x === b));
  G.mode = b.dataset.v; updateBestLine(); Sound.click();
});
function updateBestLine() {
  const best = loadStats().best[G.mode] || 0;
  $('#bestLine').textContent = best ? `🏅 your best in this mode: ${best} pts` : 'no record in this mode yet — set one!';
}

$('#startGame').onclick = () => startGame(G.mode, +$('#cfgCount').value, +$('#cfgOpts').value, +$('#cfgTimer').value);

function genQuestion(mode, nOpts) {
  const drugs = DB.filter(m => !m.nonDrug && m.ingredient);
  if (mode === 'brand2ing') {
    const m = G.only || pick(drugs);
    G.only = null;
    const used = new Set([m.ingredientKey]), others = [];
    let guard = 0;
    while (others.length < nOpts - 1 && guard++ < 800) {
      const k = pick([...groups.keys()]);
      if (used.has(k) || groups.get(k)[0].nonDrug) continue;
      used.add(k); others.push(k);
    }
    const opts = shuffle([m.ingredientKey, ...others]).map(k => ({ key: k, label: groups.get(k)[0].ingredient }));
    return { kind: 'Which ingredients / salts does this brand contain?', prompt: m.name,
             sub: [m.formulation, m.strength].filter(Boolean).join(' • '), options: opts, answerKey: m.ingredientKey, ref: m };
  }
  const keys = [...groups.keys()].filter(k => !groups.get(k)[0].nonDrug);
  const key = pick(keys), group = groups.get(key), correct = pick(group);
  const excluded = new Set(group.map(x => x.id));
  const usedKeys = new Set([key]);           // every option owns a UNIQUE ingredient set
  const distractors = []; let guard = 0;
  while (distractors.length < nOpts - 1 && guard++ < 1400) {
    const m = pick(drugs);
    if (excluded.has(m.id) || usedKeys.has(m.ingredientKey)) continue; // <- core rule
    if (norm(m.name) === norm(correct.name)) continue;
    usedKeys.add(m.ingredientKey); distractors.push(m);
  }
  const opts = shuffle([correct, ...distractors]).map(m => ({ key: String(m.id), label: m.name }));
  return { kind: 'Which brand contains exactly these ingredients?', prompt: group[0].ingredient,
           sub: null, options: opts, answerKey: String(correct.id), ref: correct };
}

function startGame(mode, count, nOpts, timer, onlyMedicine) {
  if (!DB) return;
  Sound.click(); buzz(12);
  Object.assign(G, { active: true, mode, count, nOpts, timer, qs: [], i: 0, score: 0,
                     streak: 0, bestStreak: 0, fifty: 2, answers: [], locked: false, only: onlyMedicine || null });
  let guard = 0;
  while (G.qs.length < count && guard++ < count * 80) {
    const q = genQuestion(mode, nOpts);
    if (q && q.options.length >= 3 &&
        !(G.qs.length && norm(G.qs[G.qs.length - 1].prompt) === norm(q.prompt))) G.qs.push(q);
  }
  $('#playHome').classList.add('hidden'); $('#playEnd').classList.add('hidden');
  $('#playBoard').classList.remove('hidden');
  $$('.nav-btn').forEach(x => x.classList.toggle('on', x.dataset.page === 'play'));
  ['search', 'salts', 'more'].forEach(p => $('#page-' + p).classList.add('hidden'));
  $('#page-play').classList.remove('hidden');
  setTimeout(showQuestion, 320);
}

function showQuestion() {
  clearInterval(G.tHandle); G.locked = true;
  const q = G.qs[G.i];
  $('#qNum').textContent = `Q ${G.i + 1}/${G.qs.length}`;
  $('#progBar').style.width = (G.i / G.qs.length * 100) + '%';
  $('#scoreN').textContent = G.score;
  $('#fiftyN').textContent = G.fifty;
  $('#streakTag').classList.toggle('hidden', G.streak < 2);
  $('#streakN').textContent = G.streak;
  $('#qKind').textContent = q.kind;
  $('#qPrompt').textContent = q.prompt;
  $('#qSub').textContent = q.sub || '';
  const letters = 'ABCDE';
  $('#optWrap').innerHTML = q.options.map((o, i) =>
    `<button class="opt" data-k="${esc(o.key)}" style="animation-delay:${i * 55}ms" disabled><span class="bullet">${letters[i]}</span><span>${esc(o.label)}</span></button>`).join('');
  setTimeout(() => {
    $$('#optWrap .opt').forEach(b => { b.disabled = false; b.onclick = () => answer(b.dataset.k, b); });
    G.locked = false; startTimer();
  }, 380);
}

function startTimer() {
  const tt = $('#timerTag'), tn = $('#timerN');
  if (!G.timer) { tt.classList.add('hidden'); return; }
  tt.classList.remove('hidden'); tt.classList.remove('low');
  G.tLeft = G.timer; tn.textContent = G.tLeft;
  G.tHandle = setInterval(() => {
    G.tLeft--; tn.textContent = Math.max(0, G.tLeft);
    if (G.tLeft <= 5) { tt.classList.add('low'); if (G.tLeft > 0) Sound.tick(); }
    if (G.tLeft <= 0) { clearInterval(G.tHandle); timeUp(); }
  }, 1000);
}

function timeUp() {
  if (G.locked) return;
  G.locked = true;
  const q = G.qs[G.i];
  finishMarking(q, null, false);
}

function answer(choiceKey, btn) {
  if (G.locked) return;
  G.locked = true; clearInterval(G.tHandle);
  const q = G.qs[G.i];
  const correct = choiceKey === q.answerKey;
  finishMarking(q, btn, correct);
}

function finishMarking(q, chosenBtn, correct) {
  $$('#optWrap .opt').forEach(b => {
    b.disabled = true;
    if (b.dataset.k === q.answerKey) b.classList.add('good');
    else if (chosenBtn && b === chosenBtn) b.classList.add('bad');
    else b.classList.add('dead');
  });
  if (correct) {
    G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
    G.score += 100 + (G.timer ? G.tLeft * 5 : 0) + (G.streak - 1) * 10;
    Sound.good(); buzz([14, 40, 26]);
  } else { G.streak = 0; Sound.bad(); buzz(110); }
  G.answers.push({ prompt: q.prompt, correct, ref: q.ref, answerKey: q.answerKey });
  const s = loadStats(); s.correct += correct ? 1 : 0; s.total += 1;
  s.maxStreak = Math.max(s.maxStreak, G.bestStreak); saveStats(s);
  $('#scoreN').textContent = G.score;
  $('#streakTag').classList.toggle('hidden', G.streak < 2);
  $('#streakN').textContent = Math.max(G.streak, 0);
  setTimeout(() => revealSheet(q, correct), 650);
}

/* reveal card — shows the correct answer; minimizable; ✕ or Next advances */
function revealSheet(q, correct) {
  const ref = q.ref;
  const mates = (groups.get(ref.ingredientKey) || []).filter(x => x.id !== ref.id);
  const isLast = G.i + 1 >= G.qs.length;
  const rightLabel = G.mode === 'brand2ing' ? groups.get(q.answerKey)[0].ingredient : ref.name;
  const body = document.createElement('div');
  body.className = 'sheet-body';
  body.innerHTML = `
    <div class="reveal-emoji">${correct ? '✅' : '💡'}</div>
    <div class="reveal-h ${correct ? 'good' : 'bad'}">${correct ? 'Correct!' : (G.timer && G.tLeft <= 0 ? '⏱ Time up!' : 'Not quite…')}</div>
    <div class="reveal-box">
      <div class="rb-k">${G.mode === 'brand2ing' ? 'Correct ingredients' : 'Correct brand'}</div>
      <div class="rb-v">${esc(rightLabel)}</div>
    </div>
    <div class="reveal-box">
      <div class="rb-k">${G.mode === 'brand2ing' ? 'The brand' : 'The composition'}</div>
      <div class="rb-v" style="font-size:.92rem;font-weight:600">${esc(G.mode === 'brand2ing' ? ref.name : ref.ingredient)}</div>
      <div class="q-sub">${[ref.formulation, ref.strength, rupee(ref.rate) ? 'Rate ' + rupee(ref.rate) : null].filter(Boolean).join(' • ') || ''}</div>
    </div>
    ${G.mode === 'brand2ing' && mates.length ? `
    <div class="reveal-box">
      <div class="rb-k">Other brands with the same salts</div>
      <div class="same-chips">${mates.slice(0, 12).map(x => `<button class="same-chip" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    </div>` : ''}
    <div class="detail-actions">
      <button class="btn primary big" id="rvNext">${isLast ? '🏁 See results' : 'Next question →'}</button>
    </div>
    <div class="detail-actions" style="margin-top:8px">
      <button class="btn ghost mini" id="rvDetail">📋 Full info card</button>
    </div>`;
  body.querySelectorAll('.same-chip').forEach(b => b.onclick = () => openMedicine(+b.dataset.id));
  body.querySelector('#rvDetail').onclick = () => openMedicine(ref.id);
  let advanced = false;
  const advance = () => { if (advanced) return; advanced = true; Overlays.removeCloseHook(`rev-${G.i}`); nextQuestion(); };
  body.querySelector('#rvNext').onclick = () => advance();
  Overlays.open(`rev-${G.i}`, correct ? '✅ Right!' : '💡 Correct answer', body, { onClose: advance });
}
/* helper injected on Overlays: allow cancelling a sheet's onClose hook before manual close */
Overlays.removeCloseHook = function (id) {
  const o = this.act.find(x => x.id === id); if (o) o.onClose = null;
  const m = this.min.get(id); if (m) m.onClose = null;
};

function nextQuestion() {
  Overlays.removeCloseHook(`rev-${G.i}`);
  Overlays.close(`rev-${G.i}`);
  G.i++;
  $('#progBar').style.width = (G.i / G.qs.length * 100) + '%';
  if (G.i >= G.qs.length) return endGame();
  showQuestion();
}

$('#fiftyBtn').onclick = () => {
  if (!G.active || G.locked || G.fifty <= 0) return;
  const q = G.qs[G.i];
  const wrong = $$('#optWrap .opt').filter(b => b.dataset.k !== q.answerKey && !b.disabled);
  if (wrong.length < 2) return;
  G.fifty--; $('#fiftyN').textContent = G.fifty; Sound.click(); buzz(10);
  const kill = G.qs[G.i].options.length >= 5 ? 3 : 2;
  shuffle(wrong).slice(0, Math.min(kill, wrong.length - 1)).forEach(b => { b.classList.add('dead'); b.disabled = true; });
  toast('✂ wrong options removed');
};

$('#quitBtn').onclick = () => {
  if (!G.active) return;
  Sound.click();
  const body = document.createElement('div');
  body.className = 'sheet-body';
  body.innerHTML = `<p style="color:var(--dim);margin-bottom:14px">Quit this round? Your score of <b style="color:var(--acc)">${G.score}</b> will be recorded for ${G.i} answered question${G.i === 1 ? '' : 's'}.</p>
    <div class="detail-actions"><button class="btn primary" id="qYes">Yes, end round</button>
    <button class="btn ghost" id="qNo">Keep playing</button></div>`;
  body.querySelector('#qYes').onclick = () => {
    Overlays.close('quit');
    G.qs = G.qs.slice(0, G.i);
    if (!G.qs.length) { backToHome(); return; }
    endGame();
  };
  body.querySelector('#qNo').onclick = () => Overlays.close('quit');
  Overlays.open('quit', '🏳 Quit round?', body);
};

function backToHome() {
  G.active = false; clearInterval(G.tHandle);
  $('#playBoard').classList.add('hidden'); $('#playEnd').classList.add('hidden');
  $('#playHome').classList.remove('hidden'); updateBestLine();
}

function endGame() {
  G.active = false; clearInterval(G.tHandle);
  $('#playBoard').classList.add('hidden');
  const total = G.qs.length, correctN = G.answers.filter(a => a.correct).length;
  const s = loadStats(); s.games++;
  const prevBest = s.best[G.mode] || 0;
  const isBest = G.score > prevBest && G.score > 0;
  if (isBest) s.best[G.mode] = G.score;
  saveStats(s);
  $('#endEmoji').textContent = correctN === total ? '🏆' : correctN >= Math.ceil(total / 2) ? '🎖️' : '💪';
  $('#endTitle').textContent = correctN === total ? 'Flawless round!' : correctN >= Math.ceil(total / 2) ? 'Solid round!' : 'Round over — keep grinding!';
  $('#endScore').textContent = G.score;
  $('#endGrid').innerHTML = `
    <div class="end-cell"><b>${correctN}/${total}</b><span>correct</span></div>
    <div class="end-cell"><b>${Math.round(correctN / Math.max(1, total) * 100)}%</b><span>accuracy</span></div>
    <div class="end-cell"><b>🔥 ${G.bestStreak}</b><span>best streak</span></div>
    <div class="end-cell"><b>${s.best[G.mode] || G.score}</b><span>your best</span></div>`;
  $('#newBest').classList.toggle('hidden', !isBest);
  $('#reviewList').innerHTML = `<div class="choice-label" style="margin-top:8px">Review answers</div>` +
    G.answers.map((a, i) => `<div class="rev-item"><span class="mk ${a.correct ? 'g' : 'b'}">${a.correct ? '✓' : '✗'}</span>
      <span class="rv-t">${esc(a.prompt.length > 46 ? a.prompt.slice(0, 46) + '…' : a.prompt)}</span>
      <span class="rv-v" data-i="${i}">ℹ️</span></div>`).join('');
  $$('#reviewList .rv-v').forEach(el => el.onclick = () => openMedicine(G.answers[+el.dataset.i].ref.id));
  $('#playEnd').classList.remove('hidden');
  if (isBest) { confettiBurst(); Sound.win(); } else Sound.open();
}

$('#againBtn').onclick = () => { backToHome(); Sound.click(); };
$('#shareBtn').onclick = async () => {
  const c = G.answers.filter(a => a.correct).length;
  const text = `💊 MediQuiz: I scored ${G.score} pts — ${c}/${G.qs.length} in ${G.mode === 'brand2ing' ? 'Brand→Salts' : 'Salts→Brand'} mode! Beat that 🎯`;
  try { await navigator.share({ text }); }
  catch (e) { try { await navigator.clipboard.writeText(text); toast('score copied — paste anywhere!'); } catch (e2) {} }
};

/* ============================ stats / more ============================ */
function renderStats() {
  const s = loadStats();
  const acc = s.total ? Math.round(s.correct / s.total * 100) : 0;
  $('#statGrid').innerHTML = `
    <div class="stat-cell"><b>${s.games}</b><span>rounds</span></div>
    <div class="stat-cell"><b>${s.best.brand2ing || 0}</b><span>best B→S</span></div>
    <div class="stat-cell"><b>${s.best.ing2brand || 0}</b><span>best S→B</span></div>
    <div class="stat-cell"><b>${acc}%</b><span>accuracy</span></div>
    <div class="stat-cell"><b>${s.total}</b><span>questions</span></div>
    <div class="stat-cell"><b>🔥 ${s.maxStreak}</b><span>top streak</span></div>`;
}
async function fillAbout() {
  try {
    const r = window.MQ_EMBED_SKIP || await (await fetch('data/skipped_report.json')).json();
    $('#skipList').innerHTML = `<p class="dim">${r.skipped_count} of ${r.total_raw} stock rows were skipped — no reliable source confirmed their composition. All pop-ups & learnings stay accurate because of that.</p>
      <ul>${r.skipped.map(x => `<li>${esc(x.name)}${x.formulation && x.formulation !== '—' ? ` <i>(${esc(x.formulation)})</i>` : ''}</li>`).join('')}</ul>`;
  } catch (e) { $('#skipList').textContent = 'Report unavailable offline.'; }
}
$('#resetBtn').onclick = () => { localStorage.removeItem('mq.stats'); renderStats(); toast('stats wiped'); Sound.click(); };
const soundBtn = $('#soundBtn');
soundBtn.textContent = `🔊 Sound: ${Sound.on ? 'on' : 'off'}`;
soundBtn.onclick = () => { Sound.on = !Sound.on; localStorage.setItem('mq.sound', JSON.stringify(Sound.on)); soundBtn.textContent = `🔊 Sound: ${Sound.on ? 'on' : 'off'}`; if (Sound.on) Sound.good(); };

/* ============================ confetti ============================ */
function confettiBurst() {
  const cv = $('#confetti'), ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#2dd4bf', '#fbbf24', '#f87171', '#60a5fa', '#34d399'];
  const parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * cv.width, y: -30 - Math.random() * cv.height * .45,
    w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3,
    rot: Math.random() * 360, vr: -6 + Math.random() * 12, c: pick(colors)
  }));
  let frames = 0;
  (function anim() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    });
    if (++frames < 230) requestAnimationFrame(anim);
    else ctx.clearRect(0, 0, cv.width, cv.height);
  })();
}

/* ============================ install / rotate / online ============================ */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
async function doInstall() {
  if (deferredInstall) { deferredInstall.prompt(); try { await deferredInstall.userChoice; } catch (e) {} deferredInstall = null; }
  else toast('Chrome ⋮ menu → “Add to Home screen” → Install', 2800);
}
$('#installBtn').onclick = doInstall;
$('#bellBtn').onclick = doInstall;
function setOnline() {
  $('#onlineDot').classList.toggle('off', !navigator.onLine);
  $('#onlineDot').title = navigator.onLine ? 'online' : 'offline (still works!)';
}
window.addEventListener('online', () => { setOnline(); toast('🌐 back online'); });
window.addEventListener('offline', () => { setOnline(); toast('📴 offline — fully playable'); });

function checkRotate() {
  const landscape = innerWidth > innerHeight * 1.05;
  const snoozed = sessionStorage.getItem('mq.rotSnooze') === '1';
  $('#rotateNudge').classList.toggle('hidden', !(landscape && !snoozed));
}
$('#rotateOk').onclick = () => { sessionStorage.setItem('mq.rotSnooze', '1'); checkRotate(); Sound.click(); };
$('#rotateNudge').querySelector('[data-minimize]').onclick = () => { sessionStorage.setItem('mq.rotSnooze', '1'); checkRotate(); };
window.addEventListener('resize', checkRotate);
window.addEventListener('orientationchange', () => setTimeout(checkRotate, 200));

/* backdrop tap & Esc = MINIMISE the top sheet (never lose your place) */
$('#overlayBack').onclick = () => { if (Overlays.top) Overlays.minimize(Overlays.top.id); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && Overlays.top) Overlays.minimize(Overlays.top.id); });

/* ============================ service worker ============================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

setOnline(); checkRotate();
boot();
