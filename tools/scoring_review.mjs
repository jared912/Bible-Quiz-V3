/**
 * Monte Carlo distribution check for Bible Quiz V3.
 *
 * How the 15,000 "tests" work:
 * 1. Each run simulates one full playthrough: start at Scene 1, pick a RANDOM
 *    option at every decision (including auto-advancing "Continue" bridge scenes).
 * 2. After each pick, add that choice's character-triplet vector to a running score.
 * 3. Record every step as "sceneId|choiceLabel" in choicePath (same as the live game).
 * 4. At Scene 13 (RESULT), call the same pickResult logic as mainGame.js.
 * 5. Repeat 15,000 times per gender pool and tally how often each character wins.
 *
 * The live game is deterministic: same gender + same choices => same choicePath +
 * same score => same character every time. Only this script uses randomness.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
vm.runInThisContext(fs.readFileSync(path.join(root, 'js/resultPicker.js'), 'utf8'));

const scenesJs = fs.readFileSync(path.join(root, 'js/data/scenes.js'), 'utf8');
const charsJs = fs.readFileSync(path.join(root, 'js/data/characters.js'), 'utf8');
let SCENES = {};
let CHARACTERS = {};
eval(`SCENES = ${scenesJs.match(/window\.BIBLE_QUIZ_V3_SCENES = (\{[\s\S]*\});/)[1]}`);
eval(`CHARACTERS = ${charsJs.match(/window\.BIBLE_QUIZ_V3_CHARACTERS = (\{[\s\S]*\});/)[1]}`);

const DIM_KEYS = ['action', 'social', 'leadership', 'crisis', 'spiritual'];
const START = 1;
const RUNS = 15000;

function avgVector(ids) {
  const v = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
  if (!ids.length) return v;
  for (const id of ids) {
    const c = CHARACTERS[id];
    if (!c?.vector) continue;
    for (const k of DIM_KEYS) v[k] += c.vector[k];
  }
  for (const k of DIM_KEYS) v[k] /= ids.length;
  return v;
}

function applyChoice(score, choice, pool) {
  const ids = pool === 'woman' ? choice.women : choice.men;
  const v = avgVector(ids);
  for (const k of DIM_KEYS) score[k] += v[k];
}

function getScene(id) {
  return SCENES[String(id)];
}

function decisionChoices(scene) {
  return (scene?.choices ?? []).filter((c) => c.label !== 'Continue');
}

function pickResult(score, pool, choicePath) {
  return globalThis.BIBLE_QUIZ_V3_pickResult({
    score,
    pool,
    choicePath,
    characters: CHARACTERS,
  });
}

function randomPlay(pool, n = RUNS) {
  const counts = {};
  for (let i = 0; i < n; i++) {
    let id = START;
    const score = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
    const choicePath = [];
    let guard = 0;

    while (guard++ < 100) {
      let scene = getScene(id);
      let choices = decisionChoices(scene);

      while (!choices.length && scene?.choices?.length) {
        const bridge = scene.choices[0];
        choicePath.push(`${id}|${bridge.label}`);
        if (bridge.nextId === 'RESULT') {
          const r = pickResult(score, pool, choicePath);
          counts[r] = (counts[r] ?? 0) + 1;
          id = 'RESULT';
          break;
        }
        id = bridge.nextId;
        scene = getScene(id);
        choices = decisionChoices(scene);
      }
      if (id === 'RESULT') break;
      if (!choices.length) break;

      const c = choices[Math.floor(Math.random() * choices.length)];
      choicePath.push(`${id}|${c.label}`);
      applyChoice(score, c, pool);

      if (c.nextId === 'RESULT') {
        const r = pickResult(score, pool, choicePath);
        counts[r] = (counts[r] ?? 0) + 1;
        break;
      }
      id = c.nextId;
    }
  }
  return counts;
}

function printDistribution(label, counts, n = RUNS) {
  const all = Object.values(CHARACTERS)
    .filter((c) => c.pool === label)
    .map((c) => c.id);
  const sorted = all.map((id) => [id, counts[id] ?? 0]).sort((a, b) => b[1] - a[1]);
  const maxPct = sorted.length ? (100 * sorted[0][1]) / n : 0;
  console.log(`\n${label} (max ${maxPct.toFixed(1)}%):`);
  for (const [id, c] of sorted) {
    console.log(`  ${id}: ${((100 * c) / n).toFixed(1)}%`);
  }
  return maxPct;
}

console.log(`=== RANDOM PLAYTHROUGH RESULT DISTRIBUTION (${RUNS} runs) ===`);
console.log('Picker: score-tier match + deterministic hash (choices shape plausible matches)');
let worst = 0;
for (const pool of ['woman', 'man']) {
  worst = Math.max(worst, printDistribution(pool, randomPlay(pool, RUNS), RUNS));
}
console.log(`\nWorst character share: ${worst.toFixed(1)}% (target <= 15%)`);
if (worst > 15) process.exitCode = 1;

function feelMetrics(pool, n = 3000) {
  let top1 = 0;
  let top3 = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    let id = START;
    const score = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
    const choicePath = [];
    let guard = 0;
    while (guard++ < 100) {
      let scene = getScene(id);
      let choices = decisionChoices(scene);
      while (!choices.length && scene?.choices?.length) {
        const bridge = scene.choices[0];
        choicePath.push(`${id}|${bridge.label}`);
        if (bridge.nextId === 'RESULT') {
          id = 'RESULT';
          break;
        }
        id = bridge.nextId;
        scene = getScene(id);
        choices = decisionChoices(scene);
      }
      if (id === 'RESULT') break;
      if (!choices.length) break;
      const c = choices[Math.floor(Math.random() * choices.length)];
      choicePath.push(`${id}|${c.label}`);
      applyChoice(score, c, pool);
      if (c.nextId === 'RESULT') {
        const r = pickResult(score, pool, choicePath);
        const ranked = globalThis.BIBLE_QUIZ_V3_nearestRanked(
          Object.values(CHARACTERS).filter((c) => c.pool === pool),
          score,
        );
        const rank = ranked.findIndex((x) => x.c.id === r);
        if (rank === 0) top1++;
        if (rank <= 2) top3++;
        total++;
        break;
      }
      id = c.nextId;
    }
  }
  return { top1Pct: (100 * top1) / total, top3Pct: (100 * top3) / total };
}

const wFeel = feelMetrics('woman');
const mFeel = feelMetrics('man');
console.log(`Thematic fit: result is #1 nearest match ${wFeel.top1Pct.toFixed(0)}% (W) / ${mFeel.top1Pct.toFixed(0)}% (M) of runs`);
console.log(`Thematic fit: result in top 3 nearest ${wFeel.top3Pct.toFixed(0)}% (W) / ${mFeel.top3Pct.toFixed(0)}% (M) of runs`);

function playFixedPath(pool, pickIndex = 0) {
  let id = START;
  const score = Object.fromEntries(DIM_KEYS.map((k) => [k, 0]));
  const choicePath = [];
  let guard = 0;

  while (guard++ < 100) {
    let scene = getScene(id);
    let choices = decisionChoices(scene);
    while (!choices.length && scene?.choices?.length) {
      const bridge = scene.choices[0];
      choicePath.push(`${id}|${bridge.label}`);
      if (bridge.nextId === 'RESULT') return pickResult(score, pool, choicePath);
      id = bridge.nextId;
      scene = getScene(id);
      choices = decisionChoices(scene);
    }
    if (!choices.length) throw new Error(`Stuck at scene ${id}`);
    const c = choices[pickIndex] ?? choices[0];
    choicePath.push(`${id}|${c.label}`);
    applyChoice(score, c, pool);
    if (c.nextId === 'RESULT') return pickResult(score, pool, choicePath);
    id = c.nextId;
  }
  throw new Error('Path guard exceeded');
}

const a = playFixedPath('woman', 0);
const b = playFixedPath('woman', 0);
console.log(`\nDeterminism check (woman, same path twice): ${a === b ? 'PASS' : `FAIL (${a} vs ${b})`}`);
