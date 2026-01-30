// V3 runtime
// - Story content and scoring shortlists live in `js/data/scenes.js`
// - Character definitions (including 5D vectors + card copy) live in `js/data/characters.js`

const SCENES = window.BIBLE_QUIZ_V3_SCENES ?? {};
const CHARACTERS = window.BIBLE_QUIZ_V3_CHARACTERS ?? {};
const START_SCENE_ID = window.BIBLE_QUIZ_V3_START_SCENE_ID ?? 1;

const DIM_KEYS = ['action', 'social', 'leadership', 'crisis', 'spiritual'];
const DIM_WEIGHTS = { action: 1, social: 1, leadership: 1, crisis: 1, spiritual: 1 };

// Use existing V2 art as best-effort until V3 scene art exists.
const SCENE_IMAGE_OVERRIDE = {
  1: 'smaller_images/nightfalls.png',
  2: 'smaller_images/where_to.png',
  3: 'smaller_images/dandelion.png',
  4: 'smaller_images/base_evergetable.png',
  5: 'smaller_images/dandelion.png',
  6: 'smaller_images/nightfalls.png',
  12: 'smaller_images/evergetable_climb.png',
  15: 'smaller_images/cave.png',
  17: 'smaller_images/cave.png',
  18: 'smaller_images/evergetable_climb.png',
  22: 'smaller_images/nightfalls.png',
  27: 'smaller_images/another_day.png',
  13: 'smaller_images/backhome.png',
  37: 'smaller_images/another_day.png',
  44: 'smaller_images/another_day.png',
  49: 'smaller_images/nightfalls.png',
};

// --- Gender selection (V3 requirement) ---
const GENDER_STORAGE_KEY = 'bibleQuizV3_gender';
let selectedGender = null; // 'woman' | 'man'

// --- Game state ---
let currentSceneId = START_SCENE_ID;
let score = Object.fromEntries(DIM_KEYS.map(k => [k, 0]));

// --- Results browsing state ---
// Keep insertion order from generated data (Women table then Men table).
const ALL_CHARACTER_IDS_IN_ORDER = Object.keys(CHARACTERS);
let lastResultCharacterId = null;
let browsingCharacterId = null;

function getEl(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function escHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function listHtml(items) {
  const safeItems = (items ?? []).map((x) => `<li>${escHtml(x)}</li>`).join('');
  return safeItems ? `<ul>${safeItems}</ul>` : '<p class="result-body">(Coming soon)</p>';
}

function peerHtml(reviews) {
  const items = (reviews ?? []).map((r) => {
    const quote = escHtml(r?.quote ?? '');
    const by = escHtml(r?.by ?? '');
    if (!quote && !by) return '';
    return `<div style="margin-top:10px;"><div style="font-size:18px; line-height:1.35;">“${quote}”</div><div class="result-subtitle" style="margin:4px 0 0 0;">— ${by}</div></div>`;
  }).filter(Boolean);
  return items.length ? items.join('') : '<p class="result-body">(Coming soon)</p>';
}

function loadGender() {
  try {
    const stored = localStorage.getItem(GENDER_STORAGE_KEY);
    if (stored === 'woman' || stored === 'man') selectedGender = stored;
  } catch {
    // localStorage may be unavailable; ignore
  }
}

function setGender(gender) {
  try {
    if (gender === 'woman' || gender === 'man') {
      selectedGender = gender;
      localStorage.setItem(GENDER_STORAGE_KEY, gender);
    } else {
      selectedGender = null;
      localStorage.removeItem(GENDER_STORAGE_KEY);
    }
  } catch {
    selectedGender = gender === 'woman' || gender === 'man' ? gender : null;
  }
}

function showGenderPrompt() {
  const storyText = getEl('story-text');
  const storyImage = getEl('story-image');
  const choicesContainer = getEl('choices');

  storyText.textContent = 'Are you a man or a woman?';
  storyImage.style.display = 'none';
  choicesContainer.style.display = 'flex';
  choicesContainer.innerHTML = '';

  const mkBtn = (label, gender) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = 'choice-button';
    btn.onclick = () => {
      setGender(gender);
      renderScene(currentSceneId);
    };
    return btn;
  };

  choicesContainer.appendChild(mkBtn('Woman', 'woman'));
  choicesContainer.appendChild(mkBtn('Man', 'man'));
}

function getScene(sceneId) {
  const scene = SCENES[String(sceneId)];
  if (!scene) throw new Error(`Unknown scene id: ${sceneId}`);
  return scene;
}

function getSceneImage(sceneId) {
  return SCENE_IMAGE_OVERRIDE[sceneId] ?? getScene(sceneId).image ?? 'smaller_images/placeholder.png';
}

function resetScores() {
  score = Object.fromEntries(DIM_KEYS.map(k => [k, 0]));
}

function addVectorToScore(vector) {
  for (const k of DIM_KEYS) {
    const v = Number(vector?.[k] ?? 0);
    score[k] += v;
  }
}

function averageVector(characterIds) {
  const ids = Array.isArray(characterIds) ? characterIds : [];
  if (ids.length === 0) return Object.fromEntries(DIM_KEYS.map(k => [k, 0]));

  const sum = Object.fromEntries(DIM_KEYS.map(k => [k, 0]));
  let count = 0;

  for (const id of ids) {
    const c = CHARACTERS[id];
    if (!c?.vector) continue;
    for (const k of DIM_KEYS) sum[k] += Number(c.vector[k] ?? 0);
    count++;
  }

  if (count === 0) return Object.fromEntries(DIM_KEYS.map(k => [k, 0]));
  for (const k of DIM_KEYS) sum[k] /= count;
  return sum;
}

function weightedSquaredDistance(a, b) {
  let total = 0;
  for (const k of DIM_KEYS) {
    const w = Number(DIM_WEIGHTS[k] ?? 1);
    const da = Number(a?.[k] ?? 0) - Number(b?.[k] ?? 0);
    total += w * da * da;
  }
  return total;
}

function pickResultCharacterId() {
  const pool = selectedGender === 'woman' ? 'woman' : 'man';
  const candidates = Object.values(CHARACTERS).filter(c => c?.pool === pool);

  if (candidates.length === 0) throw new Error(`No candidates found for pool: ${pool}`);

  let best = candidates[0];
  let bestDist = weightedSquaredDistance(score, best.vector);

  for (const c of candidates.slice(1)) {
    const d = weightedSquaredDistance(score, c.vector);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }

  return best.id;
}

function applyChoiceScoring(choice) {
  if (!choice) return;
  const shortlist = selectedGender === 'woman' ? choice.women : choice.men;
  addVectorToScore(averageVector(shortlist));
}

function renderScene(sceneId) {
  if (!selectedGender) {
    showGenderPrompt();
    return;
  }

  const scene = getScene(sceneId);
  const storyText = getEl('story-text');
  const storyImage = getEl('story-image');
  const choicesContainer = getEl('choices');

  const imagePath = getSceneImage(sceneId);
  const img = new Image();
  img.src = imagePath;

  const setContent = (showImage) => {
    storyText.textContent = scene.text ?? '';
    choicesContainer.innerHTML = '';

    if (showImage) {
      storyImage.style.display = 'block';
      storyImage.src = imagePath;
    } else {
      storyImage.style.display = 'none';
    }

    choicesContainer.style.display = 'flex';
    for (const choice of scene.choices ?? []) {
      const btn = document.createElement('button');
      btn.textContent = choice.label;
      btn.className = 'choice-button';
      btn.onclick = () => {
        applyChoiceScoring(choice);

        const nextId = choice.nextId;
        if (nextId === 'RESULT') {
          revealResult();
          return;
        }

        currentSceneId = Number(nextId);
        renderScene(currentSceneId);
      };
      choicesContainer.appendChild(btn);
    }
  };

  img.onload = () => setContent(true);
  img.onerror = () => setContent(false);
}

function getBrowseIndex(characterId) {
  const idx = ALL_CHARACTER_IDS_IN_ORDER.indexOf(characterId);
  return idx === -1 ? 0 : idx;
}

function stepBrowse(delta) {
  if (!ALL_CHARACTER_IDS_IN_ORDER.length) return;
  const currentId = browsingCharacterId ?? lastResultCharacterId ?? ALL_CHARACTER_IDS_IN_ORDER[0];
  const idx = getBrowseIndex(currentId);
  const nextIdx = (idx + delta + ALL_CHARACTER_IDS_IN_ORDER.length) % ALL_CHARACTER_IDS_IN_ORDER.length;
  browsingCharacterId = ALL_CHARACTER_IDS_IN_ORDER[nextIdx];
  renderCharacterCard(browsingCharacterId);
}

function renderCharacterCard(characterId) {
  const storyImage = getEl('story-image');
  const storyText = getEl('story-text');
  const choicesContainer = getEl('choices');

  const character = CHARACTERS[characterId];
  if (!character) throw new Error(`Missing character: ${characterId}`);

  storyImage.style.display = 'none';
  choicesContainer.style.display = 'none';

  const title = character.displayName ?? characterId;
  const subtitle = character.archetype ?? '';
  const scripture = character.scripture ?? '';
  const card = character.card ?? null;
  const isShowingResult = characterId === lastResultCharacterId;
  const currentIndex = getBrowseIndex(characterId) + 1;
  const totalCount = ALL_CHARACTER_IDS_IN_ORDER.length;

  storyText.innerHTML = `
    <div class="result-card">
      <div id="result-image" class="result-image-container"></div>
      <div class="result-title">You are: ${escHtml(title)}</div>
      <div class="result-subtitle">${escHtml(subtitle)}</div>
      <div class="result-subtitle">${isShowingResult ? 'Your result' : 'Browsing all characters'} • ${currentIndex}/${totalCount}</div>
      ${scripture ? `<div class="result-subtitle">Scripture: ${escHtml(scripture)}</div>` : ''}

      ${
        card
          ? `
            <div class="result-subtitle" style="margin-top: 12px;">Strengths</div>
            ${listHtml(card.strengths)}

            <div class="result-subtitle" style="margin-top: 12px;">Weaknesses</div>
            ${listHtml(card.weaknesses)}

            <div class="result-subtitle" style="margin-top: 12px;">Things ${escHtml(title)} Would Say</div>
            ${listHtml(card.sayings)}

            <div class="result-subtitle" style="margin-top: 12px;">Hidden Talent</div>
            <p class="result-body">${escHtml(card.hiddenTalent ?? '')}</p>

            <div class="result-subtitle" style="margin-top: 12px;">Peer Reviews</div>
            ${peerHtml(card.peerReviews)}
          `
          : `<p class="result-body">(Card details missing for this character.)</p>`
      }

      <div class="result-actions" id="result-actions"></div>
    </div>
  `;

  // Load artwork if present; silently ignore if missing
  const imagePath = character.image;
  if (imagePath) {
    const img = new Image();
    img.src = imagePath;
    img.onload = () => {
      const container = document.getElementById('result-image');
      if (container) {
        container.innerHTML = `<img src="${escHtml(imagePath)}" alt="${escHtml(title)}" class="result-character-image" />`;
      }
    };
  }

  const actions = document.getElementById('result-actions');
  if (!actions) return;

  const prevButton = document.createElement('button');
  prevButton.textContent = '◀ Prev';
  prevButton.className = 'choice-button';
  prevButton.onclick = () => stepBrowse(-1);

  const nextButton = document.createElement('button');
  nextButton.textContent = 'Next ▶';
  nextButton.className = 'choice-button';
  nextButton.onclick = () => stepBrowse(1);

  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copy';
  copyButton.className = 'choice-button';
  copyButton.onclick = () => {
    const text = isShowingResult
      ? `I got "${title}" in the Bible Character quiz.`
      : `Check out "${title}" in the Bible Character quiz results.`;
    navigator.clipboard.writeText(text).then(
      () => alert('Copied!'),
      () => alert('Could not copy automatically.')
    );
  };

  const playAgainButton = document.createElement('button');
  playAgainButton.textContent = 'Play again';
  playAgainButton.className = 'choice-button';
  playAgainButton.onclick = () => resetGame();

  const backToResultButton = document.createElement('button');
  backToResultButton.textContent = 'Back to my result';
  backToResultButton.className = 'choice-button';
  backToResultButton.onclick = () => {
    browsingCharacterId = lastResultCharacterId;
    renderCharacterCard(lastResultCharacterId);
  };

  const changeGenderButton = document.createElement('button');
  changeGenderButton.textContent = 'Change Man/Woman';
  changeGenderButton.className = 'choice-button';
  changeGenderButton.onclick = () => {
    setGender(null);
    resetGame();
  };

  actions.appendChild(prevButton);
  actions.appendChild(nextButton);
  actions.appendChild(copyButton);
  if (!isShowingResult && lastResultCharacterId) actions.appendChild(backToResultButton);
  actions.appendChild(playAgainButton);
  actions.appendChild(changeGenderButton);
}

function revealResult() {
  const resultId = pickResultCharacterId();
  lastResultCharacterId = resultId;
  browsingCharacterId = resultId;
  renderCharacterCard(resultId);
}

function resetGame() {
  resetScores();
  currentSceneId = START_SCENE_ID;
  renderScene(currentSceneId);
}

// Called from the Start button in index.html
window.startGame = function startGame() {
  document.querySelector('.title').style.display = 'none';
  getEl('homescreen').style.display = 'none';
  document.querySelector('.start-button').style.display = 'none';
  getEl('game-container').style.display = 'block';

  // Ensure data exists
  if (!Object.keys(SCENES).length) throw new Error('V3 scenes data not loaded.');
  if (!Object.keys(CHARACTERS).length) throw new Error('V3 characters data not loaded.');

  renderScene(currentSceneId);
};

window.onload = () => {
  loadGender();
};
