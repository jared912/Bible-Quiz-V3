/**
 * Deterministic result assignment for Bible Quiz V3.
 *
 * 1. Each choice adds a character-triplet trait vector to the running score.
 * 2. At the end, score selects a TIER of plausible matches (nearby vectors).
 * 3. A hash of gender + choice path + score picks one character inside that tier.
 *
 * Same choices => same score, same tier, same hash => same character.
 */
(function () {
  const DIM_KEYS = ['action', 'social', 'leadership', 'crisis', 'spiritual'];
  const DIM_WEIGHTS = { action: 1, social: 1, leadership: 1, crisis: 1, spiritual: 1 };
  const TIER_SIZE = 9;
  const BAND_RATIO = 1.85;

  function spreadHash(str) {
    let h1 = 2166136261;
    let h2 = 113;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 = Math.imul(h2, 31) + c;
    }
    return (h1 ^ Math.imul(h2, 2654435761)) >>> 0;
  }

  function sortedPoolCandidates(characters, pool) {
    return Object.values(characters)
      .filter((c) => c?.pool === pool)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
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

  function scoreSignature(score) {
    return DIM_KEYS.map((k) => Number(score?.[k] ?? 0).toFixed(6)).join(',');
  }

  function hashToIndex(payload, count) {
    if (count <= 1) return 0;
    const h = BigInt(spreadHash(payload));
    return Number((h * BigInt(count)) >> 32n);
  }

  function nearestRanked(candidates, score) {
    return candidates
      .map((c) => ({ c, d: weightedSquaredDistance(score, c.vector) }))
      .sort((a, b) => a.d - b.d || String(a.c.id).localeCompare(String(b.c.id)));
  }

  function buildTier(ranked) {
    const best = ranked[0].d;
    const band = ranked.filter((r) => r.d <= best * BAND_RATIO + 0.01);
    let tier = band.length >= 2 ? band : ranked.slice(0, TIER_SIZE);
    if (tier.length > TIER_SIZE) tier = tier.slice(0, TIER_SIZE);
    return tier;
  }

  /**
   * @param {{ score: object, pool: 'woman'|'man', choicePath: string[], characters: object }} opts
   */
  function pickResultCharacterId(opts) {
    const { score, pool, choicePath, characters } = opts;
    const candidates = sortedPoolCandidates(characters, pool);
    if (!candidates.length) throw new Error(`No candidates for pool: ${pool}`);

    const ranked = nearestRanked(candidates, score);
    const tier = buildTier(ranked);
    const pathKey = (choicePath ?? []).join('\0');
    const payload = `${pool}\0${pathKey}\0${scoreSignature(score)}`;
    const idx = hashToIndex(payload, tier.length);
    return tier[idx].c.id;
  }

  globalThis.BIBLE_QUIZ_V3_pickResult = pickResultCharacterId;
  globalThis.BIBLE_QUIZ_V3_nearestRanked = nearestRanked;
  globalThis.BIBLE_QUIZ_V3_buildTier = buildTier;
})();
