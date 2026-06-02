import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenesJs = fs.readFileSync(path.join(root, 'js/data/scenes.js'), 'utf8');
const charsJs = fs.readFileSync(path.join(root, 'js/data/characters.js'), 'utf8');
let SCENES = {};
let CHARACTERS = {};
eval(`SCENES = ${scenesJs.match(/window\.BIBLE_QUIZ_V3_SCENES = (\{[\s\S]*\});/)[1]}`);
eval(`CHARACTERS = ${charsJs.match(/window\.BIBLE_QUIZ_V3_CHARACTERS = (\{[\s\S]*\});/)[1]}`);

const DIM = ['action', 'social', 'leadership', 'crisis', 'spiritual'];
const RUNS = 12000;

function avgVector(ids) {
  const v = Object.fromEntries(DIM.map((k) => [k, 0]));
  for (const id of ids) {
    const c = CHARACTERS[id];
    if (!c?.vector) continue;
    for (const k of DIM) v[k] += c.vector[k];
  }
  for (const k of DIM) v[k] /= ids.length || 1;
  return v;
}
function getScene(id) {
  return SCENES[String(id)];
}
function decisionChoices(scene) {
  return (scene?.choices ?? []).filter((c) => c.label !== 'Continue');
}

function makePicker({ tierSize, bandRatio }) {
  vm.runInThisContext(`
(function(){
  const DIM_KEYS=['action','social','leadership','crisis','spiritual'];
  function spreadHash(str){let h1=2166136261,h2=113;for(let i=0;i<str.length;i++){const c=str.charCodeAt(i);h1^=c;h1=Math.imul(h1,16777619);h2=Math.imul(h2,31)+c;}return(h1^Math.imul(h2,2654435761))>>>0;}
  function dist(a,b){let t=0;for(const k of DIM_KEYS){const d=(a?.[k]??0)-(b?.[k]??0);t+=d*d;}return t;}
  function hashToIndex(p,n){if(n<=1)return 0;const h=BigInt(spreadHash(p));return Number((h*BigInt(n))>>32n);}
  function nearestRanked(c,s){return c.map(x=>({c:x,d:dist(s,x.vector)})).sort((a,b)=>a.d-b.d||String(a.c.id).localeCompare(String(b.c.id)));}
  function pickResultCharacterId(o){
    const candidates=Object.values(o.characters).filter(c=>c?.pool===o.pool).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
    const ranked=nearestRanked(candidates,o.score); const best=ranked[0].d;
    const band=ranked.filter(r=>r.d<=best*${bandRatio}+0.01);
    let tier=band.length>=2?band:ranked.slice(0,${tierSize});
    if(tier.length>${tierSize})tier=tier.slice(0,${tierSize});
    const payload=o.pool+'\\0'+(o.choicePath??[]).join('\\0')+'\\0'+DIM_KEYS.map(k=>Number(o.score?.[k]??0).toFixed(6)).join(',');
    return tier[hashToIndex(payload,tier.length)].c.id;
  }
  globalThis.BIBLE_QUIZ_V3_pickResult=pickResultCharacterId;
  globalThis.BIBLE_QUIZ_V3_nearestRanked=nearestRanked;
})();`);
}

function simulate(pool, pickFn, n) {
  const counts = {};
  let top1 = 0;
  let top3 = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    let id = 1;
    const score = Object.fromEntries(DIM.map((k) => [k, 0]));
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
      const c = choices[pickFn(choices, i)];
      choicePath.push(`${id}|${c.label}`);
      const v = avgVector(pool === 'woman' ? c.women : c.men);
      for (const k of DIM) score[k] += v[k];
      if (c.nextId === 'RESULT') {
        const r = globalThis.BIBLE_QUIZ_V3_pickResult({
          score,
          pool,
          choicePath,
          characters: CHARACTERS,
        });
        counts[r] = (counts[r] ?? 0) + 1;
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
  const max = Math.max(...Object.values(counts), 0);
  return { maxPct: (100 * max) / n, top1Pct: (100 * top1) / total, top3Pct: (100 * top3) / total };
}

for (const tierSize of [5, 6, 7, 8]) {
  for (const bandRatio of [1.2, 1.35, 1.5, 1.65, 1.8]) {
    makePicker({ tierSize, bandRatio });
    const w = simulate('woman', (choices) => Math.floor(Math.random() * choices.length), RUNS);
    const m = simulate('man', (choices) => Math.floor(Math.random() * choices.length), RUNS);
    const worst = Math.max(w.maxPct, m.maxPct);
    if (worst <= 15.5 && w.top3Pct >= 45) {
      console.log(
        `tier=${tierSize} band=${bandRatio} worst=${worst.toFixed(1)}% `
        + `W top1=${w.top1Pct.toFixed(0)} top3=${w.top3Pct.toFixed(0)} `
        + `M top1=${m.top1Pct.toFixed(0)} top3=${m.top3Pct.toFixed(0)}`,
      );
    }
  }
}
