import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..');
const QUIZ_MD_PATH = path.join(PROJECT_ROOT, 'BIBLE-CHARACTER-QUIZ.md');
const CARDS_MD_PATH = path.join(PROJECT_ROOT, 'BIBLE-CHARACTER-CARDS.md');

const OUT_SCENES_JS = path.join(PROJECT_ROOT, 'js', 'data', 'scenes.js');
const OUT_CHARACTERS_JS = path.join(PROJECT_ROOT, 'js', 'data', 'characters.js');

function stripMarkdown(s) {
  return String(s)
    .replaceAll(/\*\*(.*?)\*\*/g, '$1')
    .replaceAll(/\*(.*?)\*/g, '$1')
    .trim();
}

function normalizeCharacterId(name) {
  const n = stripMarkdown(name)
    .replaceAll(/\s+/g, ' ')
    .trim();

  // Normalize Mary variants used across docs
  if (/^Mary\s*\(Mother/i.test(n)) return 'MaryMotherOfJesus';
  if (/^Mary\s*\(Mother of Jesus\)/i.test(n)) return 'MaryMotherOfJesus';
  if (/^Mary\s*Mother of Jesus/i.test(n)) return 'MaryMotherOfJesus';
  if (/^Mary Magdalene/i.test(n)) return 'MaryMagdalene';

  // Everything else: remove punctuation/spaces into PascalCase-ish
  return n
    .replaceAll(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function parseCsvList(cell) {
  const raw = stripMarkdown(cell);
  if (!raw) return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(normalizeCharacterId);
}

function parseSceneId(cell) {
  const raw = stripMarkdown(cell);
  if (!raw) return null;
  if (/^RESULT$/i.test(raw)) return 'RESULT';
  const m = raw.match(/Scene\s+(\d+)/i);
  if (m) return Number(m[1]);
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

function parseMarkdownTable(lines) {
  // expects table block starting at header row
  const rows = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    // drop leading/trailing pipes, split by pipe
    const cols = t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim());
    rows.push(cols);
  }
  return rows;
}

function extractCharacterPoolsTable(quizMd) {
  // Extract rows from the "Character Pools" women/men tables.
  // We parse the first table under "#### Women (10)" and the first under "#### Men (10)".
  const lines = quizMd.split(/\r?\n/);
  const tables = [];

  function findTableAfter(marker) {
    const start = lines.findIndex(l => l.trim() === marker);
    if (start === -1) return null;
    // Find header row that starts with | Character |
    const headerIdx = lines.slice(start).findIndex(l => l.trim().startsWith('| Character |'));
    if (headerIdx === -1) return null;
    const absoluteHeaderIdx = start + headerIdx;
    const tableLines = [];
    for (let i = absoluteHeaderIdx; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim().startsWith('|')) break;
      tableLines.push(line);
    }
    return parseMarkdownTable(tableLines);
  }

  const womenTable = findTableAfter('#### Women (10)');
  const menTable = findTableAfter('#### Men (10)');
  if (!womenTable || !menTable) {
    throw new Error('Could not find character pool tables in quiz doc.');
  }

  tables.push({ pool: 'woman', table: womenTable });
  tables.push({ pool: 'man', table: menTable });

  const characters = {};
  for (const { pool, table } of tables) {
    // table[0] = header, table[1] = separator, then rows
    const rows = table.slice(2);
    for (const cols of rows) {
      const [characterCell, archetypeCell, traitsCell, scriptureCell] = cols;
      const displayName = stripMarkdown(characterCell);
      const id = normalizeCharacterId(displayName);
      const archetype = stripMarkdown(archetypeCell);
      const keyTraits = stripMarkdown(traitsCell);
      const scripture = stripMarkdown(scriptureCell);

      characters[id] = {
        id,
        displayName: displayName.replace(/\s+/g, ' ').trim(),
        pool,
        archetype,
        scripture,
        keyTraits,
      };
    }
  }

  return characters;
}

function vectorFromTraits(traitsString) {
  // Dimensions (all on [-1, 1])
  // action: + = Bold, - = Steady
  // social: + = People, - = Purpose
  // leadership: + = Front, - = Support
  // crisis: + = Intervene, - = Endure
  // spiritual: + = Contemplative, - = Demonstrative
  const traits = traitsString
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .map(t => t.toLowerCase());

  const vec = { action: 0, social: 0, leadership: 0, crisis: 0, spiritual: 0 };

  const has = (substr) => traits.some(t => t.includes(substr));

  // Action style
  if (has('steady')) vec.action = -1;
  if (has('bold')) vec.action = 1;
  if (has('strategic') || has('bold (eventually)') || has('strategic boldness')) vec.action = 0.5;
  if (has('steady') && (has('bold') || has('strategic'))) vec.action = 0; // conflicting/ambiguous

  // Social focus
  if (has('people-focused') || has('people focused')) vec.social = 1;
  if (has('purpose-driven') || has('purpose driven')) vec.social = -1;
  if ((has('people') && has('purpose')) || (vec.social === 1 && vec.social === -1)) vec.social = 0;

  // Leadership mode
  if (has('front-leading') || has('front leading')) vec.leadership = 1;
  if (has('support-leading') || has('support leading')) vec.leadership = -1;
  if (has('mid-leading') || has('mid leading')) vec.leadership = 0;

  // Crisis response
  if (has('intervenes') || has('intervene')) vec.crisis = 1;
  if (has('endures') || has('endure')) vec.crisis = -1;

  // Spiritual expression
  if (has('contemplative')) vec.spiritual = 1;
  if (has('demonstrative')) vec.spiritual = -1;
  if (has('balanced') || has('measured')) vec.spiritual = 0;

  return vec;
}

function extractScenes(quizMd) {
  const lines = quizMd.split(/\r?\n/);
  const scenes = {};

  // Find all scene heading indices
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

    // Extract the bold-quoted text line: **"..."**
    const quoteLine = block.find(l => l.trim().startsWith('**"'));
    const text = quoteLine
      ? stripMarkdown(quoteLine).replace(/^"+|"+$/g, '')
      : '';

    // Determine if there's a "Continue to Scene X" transition
    const continueMatch = block.join('\n').match(/→\s*Continue\s+to\s+Scene\s+(\d+)/i);

    // Find the first table for choices, if present
    const tableHeaderIdx = block.findIndex(l => l.trim().startsWith('| Choice | Goes to |'));

    const choices = [];
    if (tableHeaderIdx !== -1) {
      // Capture contiguous table lines
      const tableLines = [];
      for (let i = tableHeaderIdx; i < block.length; i++) {
        const line = block[i];
        if (!line.trim().startsWith('|')) break;
        tableLines.push(line);
      }
      const table = parseMarkdownTable(tableLines);
      const rows = table.slice(2);
      for (const cols of rows) {
        const [choiceCell, goesToCell, womenCell, menCell] = cols;
        const nextId = parseSceneId(goesToCell);
        choices.push({
          label: stripMarkdown(choiceCell),
          nextId,
          women: parseCsvList(womenCell),
          men: parseCsvList(menCell),
        });
      }
    } else if (continueMatch) {
      choices.push({
        label: 'Continue',
        nextId: Number(continueMatch[1]),
        women: [],
        men: [],
      });
    } else {
      // Scene has no explicit choices (should be rare in this doc)
      // We still include it for completeness.
    }

    // Initial image placeholders: keep old V2 placeholder for now
    // (later we can map scenes to real art)
    scenes[id] = {
      id,
      text,
      image: 'smaller_images/placeholder.png',
      choices,
    };
  }

  if (!scenes[1]) throw new Error('Scene 1 not found while parsing quiz doc.');
  return scenes;
}

function extractCards(cardsMd) {
  const lines = cardsMd.split(/\r?\n/);
  const cards = {};

  // Find every "## <number>. <NAME>" heading
  const headerRe = /^##\s+(\d+)\.\s+(.*)$/;
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headerRe);
    if (m) headers.push({ idx: i, name: m[2].trim() });
  }

  for (let h = 0; h < headers.length; h++) {
    const start = headers[h].idx;
    const end = h + 1 < headers.length ? headers[h + 1].idx : lines.length;
    const block = lines.slice(start, end);

    const rawName = stripMarkdown(headers[h].name);
    const id = normalizeCharacterId(rawName);

    // Archetype is the next bold line after the header
    const archetypeLine = block.find(l => l.trim().startsWith('**') && l.trim().endsWith('**'));
    const archetype = archetypeLine ? stripMarkdown(archetypeLine) : '';

    const getSection = (title) => {
      const idx = block.findIndex(l => l.trim().toLowerCase() === `### ${title}`.toLowerCase());
      if (idx === -1) return [];
      const out = [];
      for (let i = idx + 1; i < block.length; i++) {
        const line = block[i];
        if (line.trim().startsWith('### ')) break;
        if (line.trim() === '---') break;
        out.push(line);
      }
      return out;
    };

    const scriptureLines = getSection('Scripture Reference').map(l => stripMarkdown(l)).filter(Boolean);
    const scripture = scriptureLines.join(' ').trim();

    const strengths = getSection('Strengths:').map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => stripMarkdown(l.slice(2)));
    const weaknesses = getSection('Weaknesses:').map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => stripMarkdown(l.slice(2)));

    const sayingsSectionTitle = `Things ${rawName.split(' ')[0]} Would Say:`;
    // For Mary (Mother of Jesus), the section is "Things Mary Would Say:" (still works)
    const sayingsLines =
      getSection(sayingsSectionTitle).length > 0
        ? getSection(sayingsSectionTitle)
        : getSection('Things Mary Would Say:');

    const sayings = sayingsLines
      .map(l => l.trim())
      .filter(l => l.startsWith('> '))
      .map(l => stripMarkdown(l.replace(/^>\s*/, '')).replace(/^"+|"+$/g, ''))
      .filter(Boolean);

    const hiddenTalentLines = getSection('Hidden Talent:').map(l => stripMarkdown(l)).filter(Boolean);
    const hiddenTalent = hiddenTalentLines.join(' ').trim();

    const peerLines = getSection('Peer Reviews:').map(l => l.trim()).filter(l => l.startsWith('> '));
    const peerReviews = [];
    for (let i = 0; i < peerLines.length; i++) {
      const line = peerLines[i];
      const content = stripMarkdown(line.replace(/^>\s*/, ''));
      if (content.startsWith('—')) {
        // attribution line without preceding quote; skip
        continue;
      }

      let by = '';
      const next = peerLines[i + 1] ? stripMarkdown(peerLines[i + 1].replace(/^>\s*/, '')) : '';
      if (next.startsWith('—')) {
        by = next.replace(/^—\s*/, '').trim();
        i++;
      }
      peerReviews.push({ quote: content.replace(/^"+|"+$/g, ''), by });
    }

    cards[id] = {
      id,
      displayName: rawName.replace(/\s+/g, ' ').trim(),
      archetype,
      scripture,
      strengths,
      weaknesses,
      sayings,
      hiddenTalent,
      peerReviews,
    };
  }

  return cards;
}

function toJsLiteral(obj) {
  return JSON.stringify(obj, null, 2);
}

function buildScenesJs(scenes) {
  return `// AUTO-GENERATED. Do not edit by hand.\n// Source: BIBLE-CHARACTER-QUIZ.md\n\nwindow.BIBLE_QUIZ_V3_SCENES = ${toJsLiteral(scenes)};\nwindow.BIBLE_QUIZ_V3_START_SCENE_ID = 1;\n`;
}

function buildCharactersJs(characters) {
  return `// AUTO-GENERATED. Do not edit by hand.\n// Source: BIBLE-CHARACTER-QUIZ.md + BIBLE-CHARACTER-CARDS.md\n\nwindow.BIBLE_QUIZ_V3_CHARACTERS = ${toJsLiteral(characters)};\n`;
}

async function main() {
  const [quizMd, cardsMd] = await Promise.all([
    fs.readFile(QUIZ_MD_PATH, 'utf8'),
    fs.readFile(CARDS_MD_PATH, 'utf8'),
  ]);

  const poolCharacters = extractCharacterPoolsTable(quizMd);
  const cards = extractCards(cardsMd);

  // Merge pool metadata, vectors, and cards into a single character map.
  const characters = {};
  for (const [id, poolMeta] of Object.entries(poolCharacters)) {
    const card = cards[id];
    const vector = vectorFromTraits(poolMeta.keyTraits);

    characters[id] = {
      id,
      displayName: poolMeta.displayName ?? card?.displayName ?? id,
      pool: poolMeta.pool,
      archetype: card?.archetype ?? poolMeta.archetype,
      scripture: card?.scripture ?? poolMeta.scripture,
      keyTraits: poolMeta.keyTraits,
      vector,
      card: card
        ? {
            strengths: card.strengths,
            weaknesses: card.weaknesses,
            sayings: card.sayings,
            hiddenTalent: card.hiddenTalent,
            peerReviews: card.peerReviews,
          }
        : null,
      image: `images/characters/${id}.png`,
    };
  }

  const scenes = extractScenes(quizMd);

  await Promise.all([
    fs.writeFile(OUT_SCENES_JS, buildScenesJs(scenes), 'utf8'),
    fs.writeFile(OUT_CHARACTERS_JS, buildCharactersJs(characters), 'utf8'),
  ]);

  // eslint-disable-next-line no-console
  console.log(`Wrote:\n- ${path.relative(PROJECT_ROOT, OUT_SCENES_JS)}\n- ${path.relative(PROJECT_ROOT, OUT_CHARACTERS_JS)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

