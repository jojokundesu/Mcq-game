// MediQuiz — medicine lookup + brand↔salt MCQ game (PWA backend)
const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const app = express();
app.use(compression());
app.use(express.json());

const medicines = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/medicines.json'), 'utf8'));
const report = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/skipped_report.json'), 'utf8'));

/* ---------------- indexes ---------------- */
const byId = new Map(medicines.map(m => [m.id, m]));
const groups = new Map();              // ingredientKey -> records
for (const m of medicines) {
  if (!groups.has(m.ingredientKey)) groups.set(m.ingredientKey, []);
  groups.get(m.ingredientKey).push(m);
}
const molIndex = new Map();            // molecule -> Set(ingredientKey)
for (const [k, list] of groups) {
  for (const rec of list) for (const mol of rec.molecules || []) {
    const mk = mol.toLowerCase();
    if (!molIndex.has(mk)) molIndex.set(mk, new Set());
    molIndex.get(mk).add(k);
  }
}
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9+\s]/g, ' ').replace(/\s+/g, ' ').trim();
const tokenIndex = new Map();          // brand-token -> ids
for (const m of medicines) for (const t of norm(m.name).split(' ')) {
  if (t.length < 2) continue;
  if (!tokenIndex.has(t)) tokenIndex.set(t, []);
  tokenIndex.get(t).push(m.id);
}
function matchTokens(q) {
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  let hits = null;
  for (const t of toks) {
    const bucket = new Set();
    for (const [tok, ids] of tokenIndex) if (tok.startsWith(t)) ids.forEach(id => bucket.add(id));
    hits = hits === null ? bucket : new Set([...hits].filter(id => bucket.has(id)));
    if (!hits.size) return [];
  }
  return [...(hits || [])];
}
function saltSearch(q) {
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const out = [];
  for (const [mk, keys] of molIndex) {
    const okToks = toks.every(t => mk.includes(t));
    if (okToks) keys.forEach(k => out.push(k));
  }
  return [...new Set(out)];
}

/* ---------------- API ---------------- */
app.get('/api/health', (_req, res) => res.json({ ok: true, items: medicines.length }));

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const limit = Math.min(+req.query.limit || 24, 60);
  if (q.length < 2) return res.json({ q, salts: [], brands: [] });
  const saltKeys = saltSearch(q).slice(0, limit);
  const salts = saltKeys.map(k => {
    const list = groups.get(k);
    return { key: k, display: list[0].ingredient, count: list.length,
             brands: list.slice(0, 6).map(m => m.name) };
  });
  const brandIds = matchTokens(q).slice(0, limit);
  const brands = brandIds.map(id => {
    const m = byId.get(id);
    return { id: m.id, name: m.name, formulation: m.formulation, ingredient: m.ingredient, rate: m.rate, nonDrug: m.nonDrug };
  });
  res.json({ q, salts, brands });
});

app.get('/api/medicine/:id', (req, res) => {
  const m = byId.get(+req.params.id);
  if (!m) return res.status(404).json({ error: 'not found' });
  const same = (groups.get(m.ingredientKey) || [])
    .filter(x => x.id !== m.id).slice(0, 40)
    .map(x => ({ id: x.id, name: x.name, formulation: x.formulation, rate: x.rate }));
  res.json({ ...m, sameSalt: same });
});

app.get('/api/categories', (_req, res) => {
  const c = {};
  for (const m of medicines) c[m.category] = (c[m.category] || 0) + 1;
  res.json({ categories: Object.entries(c).sort().map(([name, count]) => ({ name, count })), total: medicines.length });
});

app.get('/api/saltgroup/:key', (req, res) => {
  const list = groups.get(req.params.key) || [];
  res.json({ key: req.params.key, items: list.map(m => ({ id: m.id, name: m.name, formulation: m.formulation, strength: m.strength, rate: m.rate })) });
});

/* -------- server-authoritative quiz (anti-guessing, works when online) -------- */
const sessions = new Map();
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(v => v[1]);

function buildQuestion(mode, nOptions) {
  if (mode === 'brand2ing') {
    const m = pick(medicines.filter(x => !x.nonDrug && x.ingredientKey));
    const used = new Set([m.ingredientKey]);
    const others = [];
    let guard = 0;
    while (others.length < nOptions - 1 && guard++ < 400) {
      const k = pick([...groups.keys()]);
      if (used.has(k)) continue;
      const g = groups.get(k)[0];
      if (g.nonDrug) continue;
      used.add(k); others.push(k);
    }
    const options = shuffle([m.ingredientKey, ...others]).map(k => ({ key: k, label: groups.get(k)[0].ingredient }));
    return { mode, kind: 'Which ingredients / salts does this brand contain?',
             prompt: m.name, sub: `${m.formulation || ''}${m.strength ? ' • ' + m.strength : ''}`,
             options, answerKey: m.ingredientKey, refId: m.id };
  }
  // ingredients -> brand: only ONE option may contain that exact ingredient set
  const key = pick([...groups.keys()].filter(k => !groups.get(k)[0].nonDrug));
  const group = groups.get(key);
  const correct = pick(group);
  const excluded = new Set(group.map(x => x.id));
  const usedKeys = new Set([key]);            // every option must own a UNIQUE ingredient set
  const distractors = [];
  let guard = 0;
  while (distractors.length < nOptions - 1 && guard++ < 900) {
    const m = pick(medicines);
    if (m.nonDrug || excluded.has(m.id) || usedKeys.has(m.ingredientKey)) continue;
    if (norm(m.name) === norm(correct.name)) continue;
    usedKeys.add(m.ingredientKey);
    distractors.push(m);
  }
  const options = shuffle([correct, ...distractors]).map(m => ({ key: String(m.id), label: m.name }));
  return { mode, kind: 'Which brand contains exactly these ingredients?',
           prompt: group[0].ingredient, options, answerKey: String(correct.id), refId: correct.id };
}

app.post('/api/quiz', (req, res) => {
  const { mode = 'brand2ing', count = 10, options = 4 } = req.body || {};
  const nOpts = Math.min(Math.max(+options, 3), 5);
  const n = Math.min(Math.max(+count, 5), 25);
  const questions = [];
  let guard = 0;
  while (questions.length < n && guard++ < n * 50) {
    const q = buildQuestion(mode, nOpts);
    if (q && q.options.length >= 3) questions.push(q);
  }
  const sid = crypto.randomUUID();
  sessions.set(sid, { questions, created: Date.now(), done: new Set() });
  if (sessions.size > 200) {  // cap memory
    const oldest = [...sessions.entries()].sort((a, b) => a[1].created - b[1].created)[0];
    sessions.delete(oldest[0]);
  }
  res.json({
    sessionId: sid,
    questions: questions.map((q, i) => ({ i, kind: q.kind, prompt: q.prompt, sub: q.sub || null, options: q.options }))
  });
});

app.post('/api/quiz/:sid/answer', (req, res) => {
  const s = sessions.get(req.params.sid);
  if (!s) return res.status(410).json({ error: 'session expired — restart quiz (or play offline)' });
  const { q: qi = 0, choice = null } = req.body || {};
  const q = s.questions[+qi];
  if (!q) return res.status(400).json({ error: 'bad question index' });
  s.done.add(+qi);
  const correct = choice === q.answerKey;
  const ref = byId.get(q.refId);
  const sameSalt = (groups.get(ref.ingredientKey) || []).slice(0, 40)
    .map(x => ({ id: x.id, name: x.name, formulation: x.formulation }));
  res.json({ correct, answer: q.answerKey, refId: q.refId,
             reveal: { id: ref.id, name: ref.name, ingredient: ref.ingredient, formulation: ref.formulation,
                       strength: ref.strength, dose: ref.dose, note: ref.note, rate: ref.rate, sameSalt } });
});

app.get('/api/report', (_req, res) => res.json(report));

/* ---------------- static + PWA ---------------- */
app.use('/data', express.static(path.join(__dirname, 'data'), { maxAge: '1h' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '7d',
  setHeaders(res, p) { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); }
}));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`MediQuiz → http://localhost:${PORT}`));
