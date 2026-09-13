/**
 * selftest.mjs — 엔진 자체 검증. `node tools/selftest.mjs` 로 실행한다.
 * 실패한 검사가 하나라도 있으면 종료 코드 1을 돌려준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStats, scoreNumbers, generateGames, describeSet, scoreSetCohesion,
  passesFilters, DEFAULT_FILTERS, softmaxWeights, makeRng, CONST,
} from '../js/engine.js';

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

console.log('\n[4-b] 조합 응집도 scoreSetCohesion');
{
  const sample = draws.slice(-30).map(r => r.slice(2, 8));
  const vals = sample.map(s => scoreSetCohesion(s, stats));
  check('모두 유한한 수', vals.every(Number.isFinite), String(vals.slice(0, 3)));
  check('값이 상수가 아님 (동점 남발 안 함)', new Set(vals.map(v => v.toFixed(6))).size > 25,
    new Set(vals.map(v => v.toFixed(6))).size + '/30 서로 다름');
  check('정렬 순서와 무관', (() => {
    const s = sample[0];
    const shuffled = [...s].reverse();
    return Math.abs(scoreSetCohesion(s, stats) - scoreSetCohesion(shuffled, stats)) < 1e-12;
  })());
  // lift 의 기준선. 비복원 추출 보정이 빠지면 여기가 0.85 로 눌린다.
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

  // 쌍 연관성이 높은 조합이 실제로 더 높은 점수를 받는가
  const high = [], low = [];
  for (const s of rand2000) {
    (meanLift(s) > 1 ? high : low).push(scoreSetCohesion(s, stats));
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  check('양쪽 표본이 모두 존재', high.length > 100 && low.length > 100,
    high.length + ' vs ' + low.length);
  check('lift 높은 조합이 더 높은 점수', avg(high) > avg(low),
    avg(high).toFixed(3) + ' vs ' + avg(low).toFixed(3));

  // 구간 분산 보정이 주 신호를 뒤집지 않는지
  check('구간 보정은 0.03 이하로만 기여', (() => {
    let maxGap = 0;
    for (const s of sample) {
      const d = describeSet(s);
      let sum = 0, c = 0;
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) { sum += stats.lift[d.sorted[a]][d.sorted[b]]; c++; }
      maxGap = Math.max(maxGap, Math.abs(scoreSetCohesion(s, stats) - sum / c));
    }
    return maxGap <= 0.03 + 1e-9;
  })());
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

console.log('\n--- 샘플 출력 (시드 20260913, 5게임) ---');
const rank = Array.from({ length: 45 }, (_, i) => i + 1).sort((x, y) => scoring.score[y] - scoring.score[x]);
console.log('점수 상위 10: ' + rank.slice(0, 10).map(n => n + '(' + scoring.score[n].toFixed(2) + ')').join(' '));
generateGames(stats, scoring, 5, { seed: 20260913 }).forEach((g, i) => {
  console.log('  ' + (i + 1) + '게임  ' + g.nums.map(n => String(n).padStart(2)).join(' ')
    + '   합계 ' + g.sum + ' / 홀' + g.odd + ':짝' + g.even + ' / 구간 ' + g.bands + ' / ' + g.method);
});

console.log('\n결과: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
