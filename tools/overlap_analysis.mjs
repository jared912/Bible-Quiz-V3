import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenesJs = fs.readFileSync(path.join(root, 'js/data/scenes.js'), 'utf8');
let SCENES = {};
eval(`SCENES = ${scenesJs.match(/window\.BIBLE_QUIZ_V3_SCENES = (\{[\s\S]*\});/)[1]}`);

const paths = {
  valley: [1, 2, 3, 8, 49, 10, 43, 39, 44, 12, 19, 20, 21, 22, 51, 24, 27, 13],
  hills: [1, 2, 4, 15, 16, 50, 18, 19, 20, 21, 22, 51, 24, 27, 13],
  river: [1, 2, 5, 28, 45, 30, 46, 32, 19, 20, 21, 22, 51, 24, 27, 13],
  wilderness: [1, 2, 6, 33, 34, 37, 38, 19, 20, 21, 22, 51, 24, 27, 13],
  wilderness_alt: [1, 2, 6, 33, 36, 37, 38, 19, 20, 21, 22, 51, 24, 27, 13],
  finale: [22, 51, 24, 27, 13],
};

function decisionChoices(scene) {
  return (scene?.choices ?? []).filter((c) => c.label !== 'Continue');
}

function pairOverlap(a, b, pool) {
  const wa = pool === 'woman' ? a.women : a.men;
  const wb = pool === 'woman' ? b.women : b.men;
  return wa.filter((x) => wb.includes(x));
}

function analyzePath(name, seq) {
  const ids = seq.filter((id) => decisionChoices(SCENES[String(id)]).length > 0);
  const issues = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const sa = SCENES[String(ids[i])];
    const sb = SCENES[String(ids[i + 1])];
    let worst = { count: 0, overlap: [], a: '', b: '' };
    for (const ca of decisionChoices(sa)) {
      for (const cb of decisionChoices(sb)) {
        for (const pool of ['woman', 'man']) {
          const o = pairOverlap(ca, cb, pool);
          if (o.length > worst.count) worst = { count: o.length, overlap: o, a: ca.label, b: cb.label, pool };
        }
      }
    }
    if (worst.count >= 2) issues.push({ from: ids[i], to: ids[i + 1], ...worst });
  }
  return issues;
}

const global = new Map();
for (const [name, seq] of Object.entries(paths)) {
  if (name.startsWith('wilderness_alt')) continue;
  const issues = analyzePath(name, seq);
  if (issues.length) {
    console.log(`\n## ${name.toUpperCase()} (${issues.length} pairs with 2+ overlap potential)`);
    for (const row of issues.sort((a, b) => b.count - a.count)) {
      const key = `${row.from}->${row.to}`;
      global.set(key, Math.max(global.get(key) ?? 0, row.count));
      console.log(`  ${row.from}->${row.to} [${row.pool}] max=${row.count} ${row.overlap.join(',')}`);
    }
  }
}

console.log('\n## GLOBAL PRIORITY (shared pairs)');
[...global.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
