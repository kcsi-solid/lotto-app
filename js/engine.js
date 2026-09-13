/**
 * engine.js — 로또 번호 분석/생성 엔진 (순수 함수, DOM 의존 없음)
 *
 * 설계 요지
 *  - 공식 데이터는 번호를 "오름차순"으로만 제공하므로 물리적 볼 추첨 순서는 알 수 없다.
 *    따라서 "순서"는 (1) 회차 간 시계열 순서, (2) 회차 내 오름차순 위치 두 가지로 해석한다.
 *  - 4개 지표를 각각 z-점수로 표준화한 뒤 가중합해 1~45번의 점수를 만든다.
 *  - 조합 선택 단계에서 역사적 분포 필터와 쌍(pair) 연관성을 적용한다.
 */
const MIN_N = 1, MAX_N = 45, PICK = 6;

/** 회차의 시간 가중치. 반감기(halfLife) 회차마다 영향력이 절반이 된다. */
function recencyWeight(age, halfLife) {
  return Math.pow(0.5, age / Math.max(1, halfLife));
}

function zeros(n) { return new Array(n).fill(0); }

/** 배열을 z-점수로 표준화. 분산이 0이면 전부 0을 돌려준다. */
function zscore(arr) {
  const vals = arr.slice(MIN_N, MAX_N + 1);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const varr = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const sd = Math.sqrt(varr);
  const out = zeros(MAX_N + 1);
  if (sd < 1e-12) return out;
  for (let n = MIN_N; n <= MAX_N; n++) out[n] = (arr[n] - mean) / sd;
  return out;
}

/**
 * 전체 통계를 한 번에 계산한다.
 * @param {Array} draws  [drwNo, date, n1..n6, bonus] 형태의 회차 배열 (회차 오름차순 정렬 가정)
 * @param {{halfLife:number}} opts
 */
export function buildStats(draws, opts = {}) {
  const halfLife = opts.halfLife ?? 260;           // 기본 약 5년치
  const T = draws.length;
  const nums = draws.map(r => r.slice(2, 8));

  // --- 지표 1: 시간 가중 출현 빈도 -------------------------------------
  const freq = zeros(MAX_N + 1);
  let wTotal = 0;
  // --- 지표 4: 오름차순 위치별 분포 ------------------------------------
  const posCount = Array.from({ length: PICK }, () => zeros(MAX_N + 1));
  const posTotal = zeros(PICK);

  for (let t = 0; t < T; t++) {
    const w = recencyWeight(T - 1 - t, halfLife);
    wTotal += w;
    nums[t].forEach((n, p) => {
      freq[n] += w;
      posCount[p][n] += w;
      posTotal[p] += w;
    });
  }
  const freqRate = zeros(MAX_N + 1);
  for (let n = MIN_N; n <= MAX_N; n++) freqRate[n] = freq[n] / (wTotal || 1);

  const posProb = posCount.map((row, p) => {
    const out = zeros(MAX_N + 1);
    for (let n = MIN_N; n <= MAX_N; n++) out[n] = row[n] / (posTotal[p] || 1);
    return out;
  });

  // --- 지표 2: 회차 간 마르코프 전이 P(j가 t+1회 | i가 t회) --------------
  // 대각선(i===j)은 "직전 회차 번호의 재출현(carry-over)"을 그대로 담는다.
  const trans = Array.from({ length: MAX_N + 1 }, () => zeros(MAX_N + 1));
  const fromW = zeros(MAX_N + 1);
  for (let t = 0; t + 1 < T; t++) {
    const w = recencyWeight(T - 2 - t, halfLife);
    for (const i of nums[t]) {
      fromW[i] += w;
      for (const j of nums[t + 1]) trans[i][j] += w;
    }
  }
  for (let i = MIN_N; i <= MAX_N; i++) {
    const d = fromW[i] || 1;
    for (let j = MIN_N; j <= MAX_N; j++) trans[i][j] /= d;
  }

  // --- 지표 3: 간격(gap) 분석 — 각 번호가 "제 리듬 대비 얼마나 밀렸나" ----
  const lastSeen = new Array(MAX_N + 1).fill(-1);
  const gapSum = zeros(MAX_N + 1), gapCnt = zeros(MAX_N + 1);
  for (let t = 0; t < T; t++) {
    for (const n of nums[t]) {
      if (lastSeen[n] >= 0) { gapSum[n] += t - lastSeen[n]; gapCnt[n] += 1; }
      lastSeen[n] = t;
    }
  }
  const gap = { current: zeros(MAX_N + 1), mean: zeros(MAX_N + 1), hazard: zeros(MAX_N + 1) };
  for (let n = MIN_N; n <= MAX_N; n++) {
    gap.current[n] = lastSeen[n] < 0 ? T : T - 1 - lastSeen[n];
    gap.mean[n] = gapCnt[n] > 0 ? gapSum[n] / gapCnt[n] : 7.5;
    gap.hazard[n] = gap.current[n] / (gap.mean[n] || 1);
  }

  // --- 쌍 연관성(lift): 두 번호가 우연보다 얼마나 자주 함께 나왔나 -------
  const pairCnt = Array.from({ length: MAX_N + 1 }, () => zeros(MAX_N + 1));
  const appearCnt = zeros(MAX_N + 1);
  for (const set of nums) {
    for (const n of set) appearCnt[n] += 1;
    for (let a = 0; a < set.length; a++) {
      for (let b = a + 1; b < set.length; b++) {
        pairCnt[set[a]][set[b]] += 1;
        pairCnt[set[b]][set[a]] += 1;
      }
    }
  }
  const pAppear = zeros(MAX_N + 1);
  for (let n = MIN_N; n <= MAX_N; n++) pAppear[n] = appearCnt[n] / (T || 1);

  const lift = Array.from({ length: MAX_N + 1 }, () => zeros(MAX_N + 1));
  for (let i = MIN_N; i <= MAX_N; i++) {
    for (let j = MIN_N; j <= MAX_N; j++) {
      if (i === j) continue;
      const expected = pAppear[i] * pAppear[j] * T;
      lift[i][j] = expected > 0 ? pairCnt[i][j] / expected : 1;
    }
  }

  const seenSets = new Set(nums.map(s => s.join('-')));
  return { T, halfLife, freqRate, posProb, trans, gap, lift, seenSets, lastDraw: nums[T - 1] || [] };
}

/**
 * 4개 지표를 z-표준화 후 가중합해 1~45번의 최종 점수를 만든다.
 */
export function scoreNumbers(stats, weights = {}) {
  const w = { freq: 0.30, markov: 0.30, gap: 0.25, position: 0.15, ...weights };

  const rawFreq = stats.freqRate;

  // 마르코프: 직전 회차에 나온 6개 번호에서 j로 가는 전이확률의 평균
  const rawMarkov = zeros(MAX_N + 1);
  for (let j = MIN_N; j <= MAX_N; j++) {
    let s = 0;
    for (const i of stats.lastDraw) s += stats.trans[i][j];
    rawMarkov[j] = stats.lastDraw.length ? s / stats.lastDraw.length : 0;
  }

  const rawGap = stats.gap.hazard;

  // 위치: 6개 자리 중 그 번호가 가장 잘 맞는 자리의 확률
  const rawPos = zeros(MAX_N + 1);
  for (let n = MIN_N; n <= MAX_N; n++) {
    let m = 0;
    for (const p of stats.posProb) if (p[n] > m) m = p[n];
    rawPos[n] = m;
  }

  const parts = {
    freq: zscore(rawFreq), markov: zscore(rawMarkov),
    gap: zscore(rawGap), position: zscore(rawPos),
  };
  const score = zeros(MAX_N + 1);
  for (let n = MIN_N; n <= MAX_N; n++) {
    score[n] = w.freq * parts.freq[n] + w.markov * parts.markov[n]
             + w.gap * parts.gap[n] + w.position * parts.position[n];
  }
  return { score, parts, weights: w, raw: { freq: rawFreq, markov: rawMarkov, gap: rawGap, position: rawPos } };
}

// --- 조합 필터: 역사적 분포에서 드문 조합을 걸러낸다 ---------------------
// 임계값은 1~1241회 실측 분포에서 뽑았다 (합계 p10~p90, 홀수 개수 82%, 연속 95%, 구간분산 97%).
export const DEFAULT_FILTERS = {
  sumMin: 100, sumMax: 177, oddMin: 2, oddMax: 4, maxConsecutive: 2, minBands: 3,
};

export function describeSet(set) {
  const s = [...set].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const odd = s.filter(n => n % 2 === 1).length;
  let best = 1, cur = 1;
  for (let i = 1; i < s.length; i++) {
    cur = s[i] === s[i - 1] + 1 ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  const bands = new Set(s.map(n => Math.min(Math.floor((n - 1) / 10), 4))).size;
  return { sorted: s, sum, odd, even: s.length - odd, maxConsecutive: best, bands };
}

export function passesFilters(set, f = DEFAULT_FILTERS, stats = null) {
  const d = describeSet(set);
  if (d.sum < f.sumMin || d.sum > f.sumMax) return false;
  if (d.odd < f.oddMin || d.odd > f.oddMax) return false;
  if (d.maxConsecutive > f.maxConsecutive) return false;
  if (d.bands < f.minBands) return false;
  if (stats && stats.seenSets.has(d.sorted.join('-'))) return false; // 과거 1등 조합과 완전 동일 → 제외
  return true;
}

/** 점수를 표본추출 가중치로 바꾼다. temperature가 낮을수록 고득점에 집중된다. */
export function softmaxWeights(score, temperature) {
  const t = Math.max(0.05, temperature);
  const vals = [];
  for (let n = MIN_N; n <= MAX_N; n++) vals.push(score[n] / t);
  const mx = Math.max(...vals);
  const exp = vals.map(v => Math.exp(v - mx));
  const sum = exp.reduce((a, b) => a + b, 0);
  const out = zeros(MAX_N + 1);
  for (let n = MIN_N; n <= MAX_N; n++) out[n] = exp[n - MIN_N] / sum;
  return out;
}

/** 가중 무작위로 중복 없이 6개를 뽑는다. */
function sampleSet(weights, rng) {
  const pool = [];
  for (let n = MIN_N; n <= MAX_N; n++) pool.push([n, weights[n]]);
  const picked = [];
  for (let k = 0; k < PICK; k++) {
    let total = 0;
    for (const p of pool) total += p[1];
    let r = rng() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r <= 0) { idx = i; break; } }
    picked.push(pool[idx][0]);
    pool.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

/**
 * 조합의 "응집도" 점수.
 *
 * 번호별 점수는 각 번호를 따로따로 평가하기 때문에, 6개를 모아놓았을 때의 성질은 보지 못한다.
 * generateGames 는 매 게임마다 후보 조합을 여러 개 뽑은 뒤 이 함수의 점수가 가장 높은 것을
 * 고른다. 값이 클수록 좋은 조합이라는 뜻이며, 모두 0을 돌려주면 보정 없이
 * 맨 처음 후보가 그대로 채택된다.
 *
 * 쓸 수 있는 재료:
 *   stats.lift[i][j]  두 번호가 우연보다 얼마나 자주 함께 나왔나 (1.0 = 우연과 같음)
 *   stats.freqRate[n] 시간 가중 출현율
 *   stats.gap.hazard[n] 자기 리듬 대비 밀린 정도
 *   describeSet(set)  { sum, odd, even, maxConsecutive, bands }
 *
 * @param {number[]} set   오름차순 6개 번호
 * @param {object} stats   buildStats 결과
 * @returns {number}       클수록 선호되는 점수
 */
export function scoreSetCohesion(set, stats) {
  // TODO(human)
  return 0;
}

/** 시드 기반 난수 — 같은 시드면 같은 결과가 나와 재현이 가능하다. */
export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * 게임 수만큼 조합을 생성한다.
 * 1게임째는 점수 상위 결정론적 조합, 이후는 가중 표본추출로 다양성을 준다.
 */
export function generateGames(stats, scoring, count, opts = {}) {
  const filters = { ...DEFAULT_FILTERS, ...(opts.filters || {}) };
  const useFilters = opts.useFilters !== false;
  const temperature = opts.temperature ?? 0.6;
  const rng = makeRng(opts.seed ?? (Date.now() & 0xffffffff));
  const weights = softmaxWeights(scoring.score, temperature);
  const games = [];
  const used = new Set();

  // 1게임째: 점수 상위 번호로 필터를 만족하는 조합을 탐욕적으로 구성
  const ranked = [];
  for (let n = MIN_N; n <= MAX_N; n++) ranked.push(n);
  ranked.sort((a, b) => scoring.score[b] - scoring.score[a]);
  let top = ranked.slice(0, PICK);
  if (useFilters && !passesFilters(top, filters, stats)) {
    let found = null;
    for (let i = 0; i < PICK && !found; i++) {
      for (let j = PICK; j < Math.min(24, ranked.length); j++) {
        const cand = [...top.slice(0, i), ...top.slice(i + 1), ranked[j]].sort((a, b) => a - b);
        if (passesFilters(cand, filters, stats)) { found = cand; break; }
      }
    }
    if (found) top = found;
  }
  top = [...top].sort((a, b) => a - b);
  games.push({ nums: top, method: 'top-score', ...describeSet(top) });
  used.add(top.join('-'));

  // 2게임째부터: 후보를 여러 개 뽑아 조합 응집도로 재평가한 뒤 가장 좋은 것을 채택한다.
  const POOL = 8;
  let guard = 0;
  const limit = Math.max(2000, count * 500);
  while (games.length < count && guard < limit) {
    guard++;
    let best = null, bestScore = -Infinity;
    for (let k = 0; k < POOL; k++) {
      const cand = sampleSet(weights, rng);
      const key = cand.join('-');
      if (used.has(key)) continue;
      if (useFilters && !passesFilters(cand, filters, stats)) continue;
      const cohesion = Number(scoreSetCohesion(cand, stats)) || 0;
      if (cohesion > bestScore) { bestScore = cohesion; best = cand; }
    }
    if (!best) continue;
    used.add(best.join('-'));
    games.push({ nums: best, method: 'weighted-sample', cohesion: bestScore, ...describeSet(best) });
  }
  // 필터가 너무 빡빡해 못 채웠다면 필터를 풀어서라도 요청한 게임 수는 채운다
  guard = 0;
  while (games.length < count && guard < limit * 4) {
    guard++;
    const cand = sampleSet(weights, rng);
    const key = cand.join('-');
    if (used.has(key)) continue;
    used.add(key);
    games.push({ nums: cand, method: 'relaxed', ...describeSet(cand) });
  }
  return games;
}

export const CONST = { MIN_N, MAX_N, PICK };
