import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quizPath = path.join(root, 'BIBLE-CHARACTER-QUIZ.md');

const WOMEN = [
  'Deborah', 'Esther', 'Abigail', 'Priscilla', 'Miriam',
  'Ruth', 'Hannah', 'MaryMotherOfJesus', 'MaryMagdalene', 'Martha',
];
const MEN = [
  'Moses', 'David', 'Elijah', 'Nehemiah', 'Daniel',
  'Joseph', 'Abraham', 'Peter', 'Paul', 'Barnabas',
];

const WOMEN_MD = {
  MaryMotherOfJesus: 'Mary (Mother)',
  MaryMagdalene: 'Mary Magdalene',
};

const PATHS = {
  valley: [1, 2, 3, 8, 49, 10, 43, 39, 44, 12, 19, 20, 21, 22, 51, 24, 27, 13],
  hills: [1, 2, 4, 15, 16, 50, 18, 19, 20, 21, 22, 51, 24, 27, 13],
  river: [1, 2, 5, 28, 45, 30, 46, 32, 19, 20, 21, 22, 51, 24, 27, 13],
  wilderness_a: [1, 2, 6, 33, 34, 37, 38, 19, 20, 21, 22, 51, 24, 27, 13],
  wilderness_b: [1, 2, 6, 33, 36, 37, 38, 19, 20, 21, 22, 51, 24, 27, 13],
};

const LOCK = new Set([1, 2]);

function combos3(pool) {
  const out = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      for (let k = j + 1; k < pool.length; k++) out.push([pool[i], pool[j], pool[k]]);
    }
  }
  return out;
}

const W_COMBOS = combos3(WOMEN);
const M_COMBOS = combos3(MEN);

function overlap(a, b) {
  return a.filter((x) => b.includes(x));
}

function maxOverlapWithSet(triplet, upstreamTriplets) {
  if (!upstreamTriplets.length) return 0;
  return Math.max(...upstreamTriplets.map((u) => overlap(triplet, u).length));
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mulberry32(seed) {
  return function rng() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function topoOrder() {
  const preds = new Map();
  const nodes = new Set();
  for (const seq of Object.values(PATHS)) {
    const ids = seq.filter((id) => id !== 37); // scene 37 is continue-only
    for (let i = 0; i < ids.length; i++) {
      nodes.add(ids[i]);
      if (!preds.has(ids[i])) preds.set(ids[i], new Set());
      if (i > 0) preds.get(ids[i]).add(ids[i - 1]);
    }
  }
  const order = [];
  const done = new Set([...LOCK]);
  const target = [...nodes].filter((id) => !LOCK.has(id)).length;
  while (order.length < target) {
    let progressed = false;
    for (const id of [...nodes].sort((a, b) => a - b)) {
      if (done.has(id)) continue;
      const ps = preds.get(id) ?? new Set();
      if ([...ps].every((p) => done.has(p))) {
        order.push(id);
        done.add(id);
        progressed = true;
      }
    }
    if (!progressed) throw new Error('Cycle in path graph');
  }
  return order.filter((id) => !LOCK.has(id));
}

function buildUpstream(sceneData, sceneId) {
  const women = [];
  const men = [];
  for (const seq of Object.values(PATHS)) {
    const ids = seq.filter((id) => sceneData[id]?.length);
    const idx = ids.indexOf(sceneId);
    if (idx <= 0) continue;
    const prev = ids[idx - 1];
    for (const ch of sceneData[prev]) {
      women.push(ch.women);
      men.push(ch.men);
    }
  }
  return { women, men };
}

function assignScene(rows, upstreamWomen, upstreamMen, rng) {
  const women = [];
  const men = [];
  const wCombos = shuffle(W_COMBOS, rng);
  const mCombos = shuffle(M_COMBOS, rng);

  function backtrack(i) {
    if (i === rows.length) return true;
    for (const wTri of wCombos) {
      if (maxOverlapWithSet(wTri, [...upstreamWomen, ...women]) > 1) continue;
      for (const mTri of mCombos) {
        if (maxOverlapWithSet(mTri, [...upstreamMen, ...men]) > 1) continue;
        women.push(wTri);
        men.push(mTri);
        if (backtrack(i + 1)) return true;
        women.pop();
        men.pop();
      }
    }
    return false;
  }

  if (!backtrack(0)) return null;
  return { women, men };
}

function validate(sceneData) {
  const details = [];
  for (const [name, seq] of Object.entries(PATHS)) {
    const ids = seq.filter((id) => sceneData[id]?.length);
    for (let i = 1; i < ids.length; i++) {
      const a = sceneData[ids[i - 1]];
      const b = sceneData[ids[i]];
      for (const ca of a) {
        for (const cb of b) {
          const ow = overlap(ca.women, cb.women).length;
          const om = overlap(ca.men, cb.men).length;
          if (ow >= 2 || om >= 2) {
            details.push({ name, from: ids[i - 1], to: ids[i], ow, om });
          }
        }
      }
    }
  }
  return details;
}

function parseScenes(md) {
  const scenes = {};
  const headingRe = /^#{2,3}\s+SCENE\s+(\d+)\b/im;
  const lines = md.split(/\r?\n/);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) headings.push({ idx: i, id: Number(m[1]) });
  }
  for (let h = 0; h < headings.length; h++) {
    const { idx, id } = headings[h];
    const endIdx = h + 1 < headings.length ? headings[h + 1].idx : lines.length;
    const block = lines.slice(idx, endIdx);
    const tableHeaderIdx = block.findIndex((l) => l.trim().startsWith('| Choice | Goes to |'));
    if (tableHeaderIdx === -1) continue;
    const rows = [];
    for (let i = tableHeaderIdx + 2; i < block.length; i++) {
      const line = block[i];
      if (!line.trim().startsWith('|')) break;
      const cols = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      rows.push({ label: cols[0], next: cols[1], women: cols[2], men: cols[3] });
    }
    scenes[id] = rows;
  }
  return scenes;
}

function parseCsvIds(cell) {
  return cell.split(',').map((s) => s.trim()).filter(Boolean).map((name) => {
    if (name === 'Mary (Mother)') return 'MaryMotherOfJesus';
    if (name === 'Mary Magdalene') return 'MaryMagdalene';
    return name.replace(/\s+/g, '');
  });
}

function toMdWomen(ids) {
  return ids.map((id) => WOMEN_MD[id] ?? id).join(', ');
}

function writeMarkdown(md, sceneData) {
  const headingRe = /^#{2,3}\s+SCENE\s+(\d+)\b/im;
  const lines = md.split(/\r?\n/);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) headings.push({ idx: i, id: Number(m[1]) });
  }
  for (let h = 0; h < headings.length; h++) {
    const { idx, id } = headings[h];
    if (LOCK.has(id) || !sceneData[id]) continue;
    const endIdx = h + 1 < headings.length ? headings[h + 1].idx : lines.length;
    const tableHeaderIdx = lines.slice(idx, endIdx).findIndex((l) => l.trim().startsWith('| Choice | Goes to |'));
    if (tableHeaderIdx === -1) continue;
    const absHeader = idx + tableHeaderIdx;
    let rowIdx = 0;
    for (let i = absHeader + 2; i < endIdx; i++) {
      if (!lines[i].trim().startsWith('|')) break;
      const row = sceneData[id][rowIdx++];
      if (!row) break;
      lines[i] = `| ${row.label} | ${row.next} | ${toMdWomen(row.women)} | ${row.men.join(', ')} |`;
    }
  }
  fs.writeFileSync(quizPath, lines.join('\n'), 'utf8');
}

const md = fs.readFileSync(quizPath, 'utf8');
const sceneRows = parseScenes(md);
const baseData = {};
for (const [id, rows] of Object.entries(sceneRows)) {
  baseData[id] = rows.map((r) => ({
    label: r.label,
    next: r.next,
    women: parseCsvIds(r.women),
    men: parseCsvIds(r.men),
  }));
}

const order = topoOrder();
console.log('Processing order:', order.join(', '));

let best = null;
let bestFails = Infinity;

for (let attempt = 0; attempt < 500; attempt++) {
  const rng = mulberry32(attempt * 9973 + 42);
  const sceneData = JSON.parse(JSON.stringify(baseData));
  let failed = false;

  for (const id of order) {
    const rows = sceneData[id];
    if (!rows?.length) continue;
    const up = buildUpstream(sceneData, id);
    const assigned = assignScene(rows, up.women, up.men, rng);
    if (!assigned) {
      failed = true;
      break;
    }
    for (let i = 0; i < rows.length; i++) {
      rows[i].women = assigned.women[i];
      rows[i].men = assigned.men[i];
    }
  }

  if (failed) continue;
  const details = validate(sceneData);
  if (details.length < bestFails) {
    bestFails = details.length;
    best = sceneData;
    console.log(`Attempt ${attempt}: ${details.length} failures`);
  }
  if (details.length === 0) {
    console.log(`Solved on attempt ${attempt}`);
    break;
  }
}

if (!best || bestFails > 0) {
  console.error(`Could not fully solve. Best: ${bestFails} failures`);
  if (bestFails <= 10) {
    const d = validate(best);
    d.slice(0, 10).forEach((x) => console.error(x));
  }
  process.exit(1);
}

writeMarkdown(md, best);
console.log('Updated BIBLE-CHARACTER-QUIZ.md with 0 adjacent overlap failures');
