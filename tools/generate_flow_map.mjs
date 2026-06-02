/**
 * Generate visual flow documentation from BIBLE-CHARACTER-QUIZ.md
 *
 * Outputs:
 *   docs/quiz-flow-map.html      — interactive map (open in browser)
 *   docs/quiz-flow-overview.mmd  — Mermaid overview for FigJam/GitHub
 *   docs/quiz-flow-paths.md      — linear path write-up with full text
 *   docs/FIGMA-FIGJAM-GUIDE.md   — how to get this into Figma/FigJam
 *
 * Run: node tools/generate_flow_map.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quizPath = path.join(root, 'BIBLE-CHARACTER-QUIZ.md');
const docsDir = path.join(root, 'docs');

const PATHS = {
  valley: {
    label: 'Valley',
    color: '#2d8a6a',
    scenes: [1, 2, 3, 7, 8, 49, 10, 43, 39, 44, 12, 19, 20, 21, 22, 51, 23, 24, 27, 13],
  },
  hills: {
    label: 'Hills',
    color: '#c9782d',
    scenes: [1, 2, 4, 15, 16, 17, 50, 18, 19, 20, 21, 22, 51, 23, 24, 27, 13],
  },
  river: {
    label: 'River',
    color: '#2d6fc9',
    scenes: [1, 2, 5, 28, 45, 30, 46, 32, 19, 20, 21, 22, 51, 23, 24, 27, 13],
  },
  wilderness_journal: {
    label: 'Wilderness (journal branch)',
    color: '#7a4dc9',
    scenes: [1, 2, 6, 33, 34, 37, 38, 19, 20, 21, 22, 51, 23, 24, 27, 13],
  },
  wilderness_noise: {
    label: 'Wilderness (night noise branch)',
    color: '#9a5dc9',
    scenes: [1, 2, 6, 33, 36, 37, 38, 19, 20, 21, 22, 51, 23, 24, 27, 13],
  },
};

function stripMarkdown(s) {
  return String(s)
    .replaceAll(/\*\*(.*?)\*\*/g, '$1')
    .replaceAll(/\*(.*?)\*/g, '$1')
    .trim();
}

function parseSceneId(cell) {
  const raw = stripMarkdown(cell);
  if (/^RESULT$/i.test(raw)) return 'RESULT';
  const m = raw.match(/Scene\s+(\d+)/i);
  if (m) return Number(m[1]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function parseMarkdownTable(lines) {
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    rows.push(t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
  }
  return rows;
}

function extractScenes(quizMd) {
  const lines = quizMd.split(/\r?\n/);
  const scenes = {};
  const headingRe = /^#{2,3}\s+SCENE\s+(\d+)\b/i;
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m) headings.push({ idx: i, id: Number(m[1]) });
  }

  for (let h = 0; h < headings.length; h++) {
    const { idx, id } = headings[h];
    const endIdx = h + 1 < headings.length ? headings[h + 1].idx : lines.length;
    const block = lines.slice(idx, endIdx);
    const headingLine = block[0] ?? '';
    const subtitle = headingLine.replace(/^#+\s+SCENE\s+\d+\s*/i, '').replace(/[()]/g, '').trim();

    const quoteLine = block.find((l) => l.trim().startsWith('**"'));
    const text = quoteLine ? stripMarkdown(quoteLine).replace(/^"+|"+$/g, '') : '';

    const continueMatch = block.join('\n').match(/→\s*Continue\s+to\s+Scene\s+(\d+)/i);
    const tableHeaderIdx = block.findIndex((l) => l.trim().startsWith('| Choice | Goes to |'));
    const choices = [];

    if (tableHeaderIdx !== -1) {
      const tableLines = [];
      for (let i = tableHeaderIdx; i < block.length; i++) {
        if (!block[i].trim().startsWith('|')) break;
        tableLines.push(block[i]);
      }
      const table = parseMarkdownTable(tableLines);
      for (const cols of table.slice(2)) {
        choices.push({
          label: stripMarkdown(cols[0]),
          nextId: parseSceneId(cols[1]),
          women: stripMarkdown(cols[2]),
          men: stripMarkdown(cols[3]),
        });
      }
    } else if (continueMatch) {
      choices.push({
        label: 'Continue',
        nextId: Number(continueMatch[1]),
        women: '',
        men: '',
        isBridge: true,
      });
    }

    scenes[id] = {
      id,
      subtitle: subtitle || undefined,
      text,
      choices,
      isTransition: Boolean(continueMatch && choices.length === 1 && choices[0].label === 'Continue'),
      isFinal: id === 13,
    };
  }
  return scenes;
}

function escHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function computeLayout(scenes) {
  const laneOf = {};
  const colOf = {};
  let maxCol = 0;

  Object.entries(PATHS).forEach(([key, path], lane) => {
    path.scenes.forEach((id, step) => {
      if (!laneOf[id]) laneOf[id] = [];
      if (!laneOf[id].includes(lane)) laneOf[id].push(lane);
      colOf[id] = Math.max(colOf[id] ?? 0, step);
      maxCol = Math.max(maxCol, step);
    });
  });

  const nodes = Object.values(scenes).map((scene) => {
    const lanes = laneOf[scene.id] ?? [0];
    const col = colOf[scene.id] ?? 0;
    const lane = lanes.length === 5 ? 2 : lanes[0];
    return {
      ...scene,
      col,
      lane,
      lanes,
      x: 40 + col * 280,
      y: 40 + lane * 200,
    };
  });

  return { nodes, maxCol };
}

function buildEdges(scenes) {
  const edges = [];
  for (const scene of Object.values(scenes)) {
    for (const choice of scene.choices) {
      if (choice.nextId === 'RESULT') continue;
      edges.push({
        from: scene.id,
        to: choice.nextId,
        label: choice.label.length > 48 ? `${choice.label.slice(0, 45)}…` : choice.label,
      });
    }
  }
  return edges;
}

function generateMermaid(scenes) {
  const lines = ['flowchart TD', '  classDef start fill:#fef3c7,stroke:#b45309', '  classDef fin fill:#dbeafe,stroke:#1d4ed8', '  classDef bridge fill:#f3f4f6,stroke:#6b7280'];

  for (const scene of Object.values(scenes).sort((a, b) => a.id - b.id)) {
    const label = `Scene ${scene.id}${scene.subtitle ? ` (${scene.subtitle})` : ''}`;
    lines.push(`  S${scene.id}["${label.replace(/"/g, "'")}"]`);
    if (scene.id === 1) lines.push(`  class S1 start`);
    if (scene.id === 13) lines.push(`  class S13 fin`);
    if (scene.isTransition) lines.push(`  class S${scene.id} bridge`);
  }

  lines.push('');
  for (const scene of Object.values(scenes)) {
    for (const choice of scene.choices) {
      const to = choice.nextId === 'RESULT' ? 'RESULT' : `S${choice.nextId}`;
      const edge = choice.label === 'Continue' ? 'Continue' : choice.label.slice(0, 30).replace(/"/g, "'");
      if (choice.nextId === 'RESULT') {
        lines.push(`  S${scene.id} -->|${edge}| R${scene.id}["RESULT"]`);
      } else {
        lines.push(`  S${scene.id} -->|${edge}| ${to}`);
      }
    }
  }

  return `${lines.join('\n')}\n`;
}

function generatePathsMarkdown(scenes) {
  const chunks = [
    '# Bible Quiz — Path Walkthroughs',
    '',
    '> Auto-generated from `BIBLE-CHARACTER-QUIZ.md`. Regenerate: `node tools/generate_flow_map.mjs`',
    '',
    'Open **`docs/quiz-flow-map.html`** in a browser for the interactive visual map.',
    '',
  ];

  for (const [key, path] of Object.entries(PATHS)) {
    chunks.push(`## ${path.label}`, '');
    chunks.push('```');
    chunks.push(path.scenes.join(' → '));
    chunks.push('```', '');

    for (const id of path.scenes) {
      const scene = scenes[id];
      if (!scene) continue;
      chunks.push(`### Scene ${id}${scene.subtitle ? ` — ${scene.subtitle}` : ''}`, '');
      chunks.push(`> ${scene.text}`, '');
      if (scene.choices.length) {
        chunks.push('| Choice | Next |');
        chunks.push('|--------|------|');
        for (const c of scene.choices) {
          const next = c.nextId === 'RESULT' ? '**RESULT**' : `Scene ${c.nextId}`;
          chunks.push(`| ${c.label.replace(/\|/g, '\\|')} | ${next} |`);
        }
        chunks.push('');
      }
    }
    chunks.push('---', '');
  }

  return chunks.join('\n');
}

function generateHtml(scenes) {
  const { nodes, maxCol } = computeLayout(scenes);
  const edges = buildEdges(scenes);
  const data = JSON.stringify({ paths: PATHS, nodes, edges, maxCol });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Bible Quiz V4 — Flow Map</title>
  <style>
    :root {
      --bg: #faf5e2;
      --panel: #fff;
      --ink: #1a1a1a;
      --muted: #5c5c5c;
      --border: #e8d9a8;
      --accent: #2d8a6a;
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: var(--bg); color: var(--ink); }
    header { padding: 16px 20px; border-bottom: 1px solid var(--border); background: #a6e6b5; position: sticky; top: 0; z-index: 10; }
    header h1 { margin: 0 0 6px; font-size: 1.25rem; }
    header p { margin: 0; font-size: 0.9rem; color: #234; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
    .toolbar button, .toolbar label { font: inherit; }
    .toolbar button { padding: 6px 12px; border: 1px solid var(--border); background: #f6e9bd; cursor: pointer; border-radius: 6px; }
    .toolbar button.active { background: #fff; border-color: var(--accent); font-weight: 600; }
    .toolbar input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; min-width: 120px; }
    main { display: grid; grid-template-columns: 1fr 380px; min-height: calc(100vh - 120px); }
    @media (max-width: 960px) { main { grid-template-columns: 1fr; } #detail { order: -1; max-height: 40vh; } }
    #canvas-wrap { overflow: auto; position: relative; background: repeating-linear-gradient(0deg, transparent, transparent 199px, #00000008 199px, #00000008 200px), repeating-linear-gradient(90deg, transparent, transparent 279px, #00000008 279px, #00000008 280px); }
    #graph { position: relative; min-width: 800px; min-height: 600px; }
    svg.edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
    .node { position: absolute; width: 220px; padding: 10px 12px; border: 2px solid var(--border); border-radius: 10px; background: var(--panel); cursor: pointer; box-shadow: 0 2px 8px #0001; transition: box-shadow .15s, transform .15s; }
    .node:hover { box-shadow: 0 4px 16px #0002; transform: translateY(-1px); }
    .node.selected { border-color: var(--accent); box-shadow: 0 0 0 3px #2d8a6a44; }
    .node.dim { opacity: 0.25; }
    .node .id { font-weight: 700; font-size: 0.85rem; color: var(--accent); }
    .node .sub { font-size: 0.75rem; color: var(--muted); margin-bottom: 4px; }
    .node .preview { font-size: 0.78rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .node.bridge { border-style: dashed; background: #f9fafb; }
    .node.final { border-color: #1d4ed8; }
    #timeline { display: none; padding: 20px; max-width: 900px; }
    #timeline.active { display: block; }
    #timeline .step { margin-bottom: 24px; padding-left: 16px; border-left: 4px solid var(--border); }
    #timeline .step h3 { margin: 0 0 8px; }
    #timeline .choices { margin: 0; padding-left: 18px; }
    #timeline .choices li { margin-bottom: 6px; }
    #detail { border-left: 1px solid var(--border); background: var(--panel); overflow: auto; padding: 16px; }
    #detail h2 { margin: 0 0 8px; font-size: 1.1rem; }
    #detail .scene-text { line-height: 1.5; margin-bottom: 16px; white-space: pre-wrap; }
    #detail .choice-block { border: 1px solid var(--border); border-radius: 8px; padding: 10px; margin-bottom: 8px; background: #fafafa; }
    #detail .choice-block .next { font-size: 0.85rem; color: var(--muted); margin-top: 6px; }
    #detail .scores { font-size: 0.8rem; color: var(--muted); margin-top: 4px; }
    .empty { color: var(--muted); font-style: italic; }
  </style>
</head>
<body>
  <header>
    <h1>Bible Quiz V4 — Scene Flow Map</h1>
    <p>All scenes, full story text, and branch progression. Generated from BIBLE-CHARACTER-QUIZ.md</p>
    <div class="toolbar">
      <button type="button" id="view-graph" class="active">Graph view</button>
      <button type="button" id="view-timeline">Path timeline</button>
      <span style="margin-left:8px">Path filter:</span>
      <button type="button" data-path="all" class="path-btn active">All paths</button>
      <button type="button" data-path="valley" class="path-btn">Valley</button>
      <button type="button" data-path="hills" class="path-btn">Hills</button>
      <button type="button" data-path="river" class="path-btn">River</button>
      <button type="button" data-path="wilderness_journal" class="path-btn">Wilderness A</button>
      <button type="button" data-path="wilderness_noise" class="path-btn">Wilderness B</button>
      <label>Jump to scene <input type="number" id="jump-scene" min="1" max="51" placeholder="#" /></label>
    </div>
  </header>
  <main>
    <div id="canvas-wrap">
      <div id="graph"></div>
      <div id="timeline"></div>
    </div>
    <aside id="detail"><p class="empty">Click a scene node or timeline step to read full text and choices.</p></aside>
  </main>
  <script>
    const DATA = ${data};
    const graphEl = document.getElementById('graph');
    const timelineEl = document.getElementById('timeline');
    const detailEl = document.getElementById('detail');
    let activePath = 'all';
    let selectedId = null;

    function sceneById(id) { return DATA.nodes.find(n => n.id === id); }

    function pathSceneSet(key) {
      if (key === 'all') return new Set(DATA.nodes.map(n => n.id));
      return new Set(DATA.paths[key].scenes);
    }

    function renderDetail(id) {
      const scene = sceneById(id);
      if (!scene) return;
      selectedId = id;
      document.querySelectorAll('.node').forEach(n => n.classList.toggle('selected', Number(n.dataset.id) === id));
      let html = '<h2>Scene ' + scene.id + (scene.subtitle ? ' — ' + esc(scene.subtitle) : '') + '</h2>';
      html += '<div class="scene-text">' + esc(scene.text) + '</div>';
      if (!scene.choices.length) {
        html += '<p class="empty">No choices (dead end in doc).</p>';
      } else {
        html += '<h3 style="margin:0 0 10px;font-size:1rem">Choices</h3>';
        for (const c of scene.choices) {
          const next = c.nextId === 'RESULT' ? 'RESULT (end of quiz)' : 'Scene ' + c.nextId;
          html += '<div class="choice-block"><strong>' + esc(c.label) + '</strong><div class="next">→ ' + next + '</div>';
          if (c.women || c.men) html += '<div class="scores">Women: ' + esc(c.women) + '<br>Men: ' + esc(c.men) + '</div>';
          html += '</div>';
        }
      }
      detailEl.innerHTML = html;
    }

    function esc(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function renderGraph() {
      graphEl.innerHTML = '';
      const allowed = pathSceneSet(activePath);
      const w = 40 + (DATA.maxCol + 1) * 280;
      const h = 40 + 5 * 200;
      graphEl.style.width = w + 'px';
      graphEl.style.height = h + 'px';

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'edges');
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      graphEl.appendChild(svg);

      const nodePos = {};
      for (const node of DATA.nodes) {
        const el = document.createElement('div');
        el.className = 'node' + (node.isTransition ? ' bridge' : '') + (node.isFinal ? ' final' : '');
        el.dataset.id = node.id;
        el.style.left = node.x + 'px';
        el.style.top = node.y + 'px';
        if (!allowed.has(node.id)) el.classList.add('dim');
        el.innerHTML = '<div class="id">Scene ' + node.id + '</div>' +
          (node.subtitle ? '<div class="sub">' + esc(node.subtitle) + '</div>' : '') +
          '<div class="preview">' + esc(node.text) + '</div>';
        el.onclick = () => renderDetail(node.id);
        graphEl.appendChild(el);
        nodePos[node.id] = { x: node.x + 110, y: node.y + 40 };
      }

      for (const edge of DATA.edges) {
        if (!allowed.has(edge.from) || !allowed.has(edge.to)) continue;
        const a = nodePos[edge.from];
        const b = nodePos[edge.to];
        if (!a || !b) continue;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mx = (a.x + b.x) / 2;
        path.setAttribute('d', 'M' + a.x + ',' + a.y + ' C' + mx + ',' + a.y + ' ' + mx + ',' + b.y + ' ' + b.x + ',' + b.y);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#94a3b8');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('marker-end', 'url(#arrow)');
        svg.appendChild(path);
      }

      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker>';
      svg.prepend(defs);
    }

    function renderTimeline() {
      const key = activePath === 'all' ? 'valley' : activePath;
      const path = DATA.paths[key];
      timelineEl.innerHTML = '<h2 style="margin-top:0">' + esc(path.label) + ' — linear walkthrough</h2>';
      for (const id of path.scenes) {
        const scene = sceneById(id);
        if (!scene) continue;
        const div = document.createElement('div');
        div.className = 'step';
        div.style.borderColor = path.color;
        div.innerHTML = '<h3>Scene ' + scene.id + (scene.subtitle ? ' — ' + esc(scene.subtitle) : '') + '</h3><p>' + esc(scene.text) + '</p>';
        if (scene.choices.length) {
          const ul = document.createElement('ul');
          ul.className = 'choices';
          for (const c of scene.choices) {
            const li = document.createElement('li');
            const next = c.nextId === 'RESULT' ? 'RESULT' : 'Scene ' + c.nextId;
            li.innerHTML = '<strong>' + esc(c.label) + '</strong> → ' + next;
            ul.appendChild(li);
          }
          div.appendChild(ul);
        }
        div.style.cursor = 'pointer';
        div.onclick = () => renderDetail(id);
        timelineEl.appendChild(div);
      }
    }

    document.querySelectorAll('.path-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.path-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activePath = btn.dataset.path;
        renderGraph();
        renderTimeline();
      };
    });

    document.getElementById('view-graph').onclick = () => {
      document.getElementById('view-graph').classList.add('active');
      document.getElementById('view-timeline').classList.remove('active');
      graphEl.style.display = 'block';
      timelineEl.classList.remove('active');
    };
    document.getElementById('view-timeline').onclick = () => {
      document.getElementById('view-timeline').classList.add('active');
      document.getElementById('view-graph').classList.remove('active');
      graphEl.style.display = 'none';
      timelineEl.classList.add('active');
      renderTimeline();
    };

    document.getElementById('jump-scene').onchange = (e) => {
      const id = Number(e.target.value);
      if (sceneById(id)) {
        renderDetail(id);
        const node = document.querySelector('.node[data-id="' + id + '"]');
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
    };

    renderGraph();
    renderTimeline();
    renderDetail(1);
  </script>
</body>
</html>`;
}

const FIGJAM_GUIDE = `# Figma / FigJam flow map guide

This project does **not** ship a native \`.fig\` file. Figma and FigJam files are cloud/binary formats that cannot be authored reliably from code without the Figma API and a paid workflow.

## Recommended approach (in this repo)

| File | Purpose |
|------|---------|
| **\`docs/quiz-flow-map.html\`** | **Best for reading everything** — open in any browser. Graph + path timeline + full scene text. |
| **\`docs/quiz-flow-paths.md\`** | Printable / diff-friendly linear walkthrough of every path. |
| **\`docs/quiz-flow-overview.mmd\`** | Compact Mermaid diagram (structure only, not full copy). |

Regenerate after quiz edits:

\`\`\`bash
node tools/generate_flow_map.mjs
\`\`\`

Also run after markdown changes (or add to your usual generate step):

\`\`\`bash
node tools/generate_v3_data.mjs
node tools/generate_flow_map.mjs
\`\`\`

## If you still want FigJam

1. **Mermaid → FigJam**  
   - Open \`docs/quiz-flow-overview.mmd\` in GitHub (renders automatically) or [mermaid.live](https://mermaid.live).  
   - Export as SVG/PNG, or use a FigJam plugin such as **「Mermaid to FigJam」** to paste the diagram as stickies/shapes.

2. **Import the HTML as reference**  
   - Open \`docs/quiz-flow-map.html\` beside FigJam and rebuild sections you care about (shared finale, one path per frame).

3. **Figma API (advanced)**  
   - Only worth it if you need a living FigJam board synced to CI. Requires a Figma access token and custom script.

## Why not a single FigJam file in git?

- \`.fig\` files are not plain text — they do not diff or merge well in git.
- The HTML generator stays **in sync** with \`BIBLE-CHARACTER-QUIZ.md\`, which is the source of truth.
- You get **all scene text** in one place; FigJam stickies would be painful to maintain by hand for 50+ scenes.

## Quick start

Double-click or open:

\`\`\`
docs/quiz-flow-map.html
\`\`\`

Use **Path timeline** for a single-path read-through; use **Graph view** to see branches converge at Scene 19 and the shared finale.
`;

async function main() {
  const quizMd = await fs.readFile(quizPath, 'utf8');
  const scenes = extractScenes(quizMd);
  await fs.mkdir(docsDir, { recursive: true });

  await fs.writeFile(path.join(docsDir, 'quiz-flow-map.html'), generateHtml(scenes), 'utf8');
  await fs.writeFile(path.join(docsDir, 'quiz-flow-overview.mmd'), generateMermaid(scenes), 'utf8');
  await fs.writeFile(path.join(docsDir, 'quiz-flow-paths.md'), generatePathsMarkdown(scenes), 'utf8');
  await fs.writeFile(path.join(docsDir, 'FIGMA-FIGJAM-GUIDE.md'), FIGJAM_GUIDE, 'utf8');

  console.log('Wrote:');
  console.log('  docs/quiz-flow-map.html');
  console.log('  docs/quiz-flow-overview.mmd');
  console.log('  docs/quiz-flow-paths.md');
  console.log('  docs/FIGMA-FIGJAM-GUIDE.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
