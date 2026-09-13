/**
 * selftest.mjs — 엔진 자체 검증. `node tools/selftest.mjs` 로 실행한다.
 * 실패한 검사가 하나라도 있으면 종료 코드 1을 돌려준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStats, scoreNumbers, generateGames, scoreSetCohesion,
  passesFilters, DEFAULT_FILTERS, softmaxWeights, makeRng, CONST,
} from '../js/engine.js';
import { shouldShowInterstitial } from '../js/monetize.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'draws.json'), 'utf8'));
const draws = db.draws;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
}

console.log('데이터: ' + db.count + '회차 (1~' + db.latest + '), ' + db.source);

console.log('\n[1] 데이터 무결성');
check('회차 결측 없음', draws.length === db.latest - draws[0][0] + 1);
check('모든 회차가 서로 다른 6개 번호', draws.every(r => new Set(r.slice(2, 8)).size === 6));
check('모든 번호가 1~45 범위', draws.every(r => r.slice(2, 8).every(n => n >= 1 && n <= 45)));

console.log('\n[2] 통계 계산');
const t0 = Date.now();
const stats = buildStats(draws, { halfLife: 260 });
const buildMs = Date.now() - t0;
check('buildStats 1초 이내 (' + buildMs + 'ms)', buildMs < 1000);
const freqSum = stats.freqRate.slice(1).reduce((a, b) => a + b, 0);
check('시간가중 출현율 합계 = 6.0', Math.abs(freqSum - 6) < 1e-9, freqSum.toFixed(6));
const rowOk = [];
for (let i = 1; i <= 45; i++) {
  const s = stats.trans[i].slice(1).reduce((a, b) => a + b, 0);
  rowOk.push(Math.abs(s - 6) < 1e-6);
}
check('마르코프 각 행 합계 = 6.0 (한 회차당 6개 번호)', rowOk.every(Boolean));
check('평균 간격이 이론값 7.5 근처', (() => {
  const m = stats.gap.mean.slice(1).reduce((a, b) => a + b, 0) / 45;
  return m > 6.5 && m < 8.5;
})(), (stats.gap.mean.slice(1).reduce((a, b) => a + b, 0) / 45).toFixed(2));
check('직전 회차 = ' + stats.lastDraw.join(','),
  stats.lastDraw.join(',') === draws[draws.length - 1].slice(2, 8).join(','));

console.log('\n[3] 점수화');
const scoring = scoreNumbers(stats);
const zsum = scoring.parts.freq.slice(1).reduce((a, b) => a + b, 0);
check('z-점수 평균 = 0', Math.abs(zsum) < 1e-9, zsum.toExponential(2));
check('점수가 모두 유한값', scoring.score.slice(1).every(Number.isFinite));
const sw = softmaxWeights(scoring.score, 0.6);
check('softmax 가중치 합계 = 1', Math.abs(sw.slice(1).reduce((a, b) => a + b, 0) - 1) < 1e-9);

console.log('\n[4] 조합 생성');
for (const count of [1, 5, 10, 45, 100]) {
  const games = generateGames(stats, scoring, count, { seed: 20260913 });
  const keys = new Set(games.map(g => g.nums.join('-')));
  const ok = games.length === count
    && keys.size === count
    && games.every(g => g.nums.length === 6 && new Set(g.nums).size === 6)
    && games.every(g => g.nums.every(n => n >= 1 && n <= 45))
    && games.every(g => g.nums.every((n, i, a) => i === 0 || a[i - 1] < n));
  check(count + '게임: 개수/중복없음/6개/범위/오름차순', ok);
}
const filtered = generateGames(stats, scoring, 40, { seed: 7 });
const strict = filtered.filter(g => g.method !== 'relaxed');
check('필터 통과 조합은 실제로 필터를 만족',
  strict.every(g => passesFilters(g.nums, DEFAULT_FILTERS, stats)));
check('과거 1등 조합과 동일한 조합 없음',
  strict.every(g => !stats.seenSets.has(g.nums.join('-'))));

console.log('\n[4-b] 쌍 연관성 lift 계산');
{
  // lift 의 기준선. 기대 동시출현을 p_i*p_j*T 로 잡으면(독립 추출 가정)
  // 모든 값이 (5/44)/(6/45) = 0.8523 배로 눌린다. 로또는 비복원 추출이다.
  // 범위를 좁게 잡아야 그 오류를 잡을 수 있다.
  const rngT = makeRng(4242);
  const randSet = () => {
    const pool = Array.from({ length: 45 }, (_, i) => i + 1);
    for (let k = 0; k < 6; k++) {
      const j = k + Math.floor(rngT() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    return pool.slice(0, 6).sort((x, y) => x - y);
  };
  const meanLift = s => {
    let sum = 0, c = 0;
    for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { sum += stats.lift[s[a]][s[b]]; c++; }
    return sum / c;
  };
  const rand2000 = Array.from({ length: 2000 }, randSet);
  const baseline = rand2000.reduce((a, s) => a + meanLift(s), 0) / rand2000.length;
  check('무작위 조합의 평균 lift = 1.0 (비복원 보정 확인)',
    Math.abs(baseline - 1) < 0.02, baseline.toFixed(4));
  const above = rand2000.filter(s => meanLift(s) > 1).length;
  check('lift 가 1.0 양쪽으로 분포', above > 500 && above < 1500, above + '/2000 이 1.0 초과');
  check('lift 대각선(i===j)은 쓰지 않음',
    Array.from({ length: 45 }, (_, i) => stats.lift[i + 1][i + 1]).every(v => v === 0));

  // 조합 응집도는 현재 보정하지 않는다. 쌍 연관성을 점수로 써 봤으나
  // 백테스트에서 효과가 없어(0.7801 -> 0.7757) 걷어냈다.
  const sample = draws.slice(-20).map(r => r.slice(2, 8));
  check('scoreSetCohesion 은 현재 무보정(0)',
    sample.every(s => scoreSetCohesion(s, stats) === 0));
}

console.log('\n[5] 재현성');
const a = generateGames(stats, scoring, 10, { seed: 12345 }).map(g => g.nums.join(','));
const b = generateGames(stats, scoring, 10, { seed: 12345 }).map(g => g.nums.join(','));
const c = generateGames(stats, scoring, 10, { seed: 54321 }).map(g => g.nums.join(','));
check('같은 시드 → 같은 결과', a.join('|') === b.join('|'));
check('다른 시드 → 다른 결과', a.join('|') !== c.join('|'));

console.log('\n[6] 경계 상황');
const tiny = buildStats(draws.slice(0, 2), {});
check('2회차 데이터로도 오류 없이 동작', Number.isFinite(scoreNumbers(tiny).score[1]));
const one = buildStats(draws.slice(0, 1), {});
check('1회차 데이터로도 오류 없이 동작', generateGames(one, scoreNumbers(one), 3, { seed: 1 }).length === 3);

console.log('\n[7] 전면 광고 정책');
// monetize.js 는 네이티브에서만 돌지만 이 함수만은 순수 로직이라 여기서 검증할 수 있다.
// 시각을 인자로 주입해 실제 시간을 기다리지 않는다.
const MIN = 60_000;
const adBase = { startedAt: 0, generateCount: 3, interstitialShownAt: 0, interstitialCount: 0 };
const at = (over, now) => shouldShowInterstitial({ ...adBase, ...over }, now);

check('1회 생성에는 안 띄움', at({ generateCount: 1 }, 10 * MIN) === false);
check('2회 생성에도 안 띄움', at({ generateCount: 2 }, 10 * MIN) === false);
check('3회 생성부터 띄움', at({}, 10 * MIN) === true);
check('시작 45초 전에는 연타해도 안 띄움', at({ generateCount: 9 }, 30_000) === false);
check('시작 45초 후에는 띄움', at({ generateCount: 9 }, 50_000) === true);
check('쿨다운 3분 안에는 안 띄움', at({ interstitialShownAt: 9 * MIN, interstitialCount: 1 }, 11 * MIN) === false);
check('쿨다운 3분 후에는 띄움', at({ interstitialShownAt: 5 * MIN, interstitialCount: 1 }, 9 * MIN) === true);
check('세션 상한 2회를 넘기면 안 띄움', at({ interstitialShownAt: MIN, interstitialCount: 2 }, 100 * MIN) === false);
check('상한 직전(1회)은 아직 띄움', at({ interstitialShownAt: MIN, interstitialCount: 1 }, 100 * MIN) === true);
// 광고를 한 번도 안 띄운 세션에서 interstitialShownAt 은 0 이다. 이걸 시각으로 취급하면
// "아주 오래전"이 되어 쿨다운을 건너뛰는데, 첫 광고에는 그게 의도한 동작이다.
check('첫 광고는 쿨다운을 따지지 않음', at({ interstitialShownAt: 0 }, MIN) === true);

console.log('\n--- 샘플 출력 (시드 20260913, 5게임) ---');
const rank = Array.from({ length: 45 }, (_, i) => i + 1).sort((x, y) => scoring.score[y] - scoring.score[x]);
console.log('점수 상위 10: ' + rank.slice(0, 10).map(n => n + '(' + scoring.score[n].toFixed(2) + ')').join(' '));
generateGames(stats, scoring, 5, { seed: 20260913 }).forEach((g, i) => {
  console.log('  ' + (i + 1) + '게임  ' + g.nums.map(n => String(n).padStart(2)).join(' ')
    + '   합계 ' + g.sum + ' / 홀' + g.odd + ':짝' + g.even + ' / 구간 ' + g.bands + ' / ' + g.method);
});

console.log('\n결과: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
