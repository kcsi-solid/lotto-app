/**
 * backtest.mjs — 워크포워드 백테스트.
 *
 * 묻는 것: "이 엔진이 무작위보다 실제로 나은가?"
 *
 * 방법
 *   회차 t를 맞히려 할 때 draws[0 .. t-1] 만 엔진에 넘긴다.
 *   t회차가 통계에 섞이면(look-ahead) 결과가 통째로 무의미해지므로 단언문으로 막는다.
 *
 * 비교 대상 세 가지
 *   engine  현재 가중치로 생성
 *   random  1~45에서 균등하게 6개
 *   filter  점수 없이 역사적 분포 필터만 통과한 무작위
 *
 * 유의성
 *   같은 회차에서 뽑은 N게임은 같은 통계에서 나와 서로 독립이 아니다.
 *   게임을 표본으로 세면 표본 수가 부풀려져 실제보다 유의해 보인다.
 *   그래서 회차별 평균을 표본 하나로 묶고, 회차 단위 대응표본 t-검정을 쓴다.
 *   회차끼리는 독립 시행이므로 이 묶음이 타당하다.
 *
 * 사용법
 *   node tools/backtest.mjs
 *   node tools/backtest.mjs --holdout 200 --games 5
 *   node tools/backtest.mjs --weights freq=0.5,markov=0.5,gap=0,position=0
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStats, scoreNumbers, generateGames,
  passesFilters, DEFAULT_FILTERS, makeRng, CONST,
} from '../js/engine.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* ------------------------------------------------------------ 인자 파싱 */

function parseArgs(argv) {
  const out = { holdout: 200, games: 5, halfLife: 260, temperature: 0.6, weights: null };
  for (let i = 0; i < argv.length; i++) {
    const [k, inline] = argv[i].split('=');
    const val = inline !== undefined ? inline : argv[i + 1];
    const take = () => { if (inline === undefined) i++; return val; };
    switch (k) {
      case '--holdout': out.holdout = Number(take()); break;
      case '--games': out.games = Number(take()); break;
      case '--halfLife': out.halfLife = Number(take()); break;
      case '--temperature': out.temperature = Number(take()); break;
      case '--weights': {
        out.weights = {};
        for (const pair of String(take()).split(',')) {
          const [name, v] = pair.split('=');
          if (name && v !== undefined) out.weights[name.trim()] = Number(v);
        }
        break;
      }
      default: break;
    }
  }
  return out;
}

/* -------------------------------------------------------------- 통계 도구 */

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);

function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

/** 대응표본 t-검정. 두 방법을 같은 회차에서 비교하므로 대응표본이 맞다. */
function pairedT(a, b) {
  const d = a.map((v, i) => v - b[i]);
  const m = mean(d);
  const se = stdev(d) / Math.sqrt(d.length || 1);
  return { diff: m, se, t: se > 0 ? m / se : 0, n: d.length };
}

/* ---------------------------------------------------------- 기준선 생성기 */

/** 1~45에서 균등하게 6개 (부분 피셔-예이츠). */
function randomSet(rng) {
  const pool = Array.from({ length: CONST.MAX_N }, (_, i) => i + 1);
  for (let k = 0; k < CONST.PICK; k++) {
    const j = k + Math.floor(rng() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
  }
  return pool.slice(0, CONST.PICK).sort((x, y) => x - y);
}

function randomGames(n, rng) {
  return Array.from({ length: n }, () => randomSet(rng));
}

/** 점수는 쓰지 않고 역사적 분포 필터만 통과시킨 무작위. */
function filteredGames(n, rng) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 500) {
    guard++;
    const s = randomSet(rng);
    if (passesFilters(s, DEFAULT_FILTERS)) out.push(s);
  }
  while (out.length < n) out.push(randomSet(rng));   // 못 채우면 그냥 무작위로
  return out;
}

/* ------------------------------------------------------------- 집계 그릇 */

function newTally() {
  return { perDrawMean: [], hist: new Array(7).fill(0), games: 0, totalHits: 0 };
}

function record(tally, sets, actual) {
  const actualSet = new Set(actual);
  const hits = sets.map(s => s.reduce((c, n) => c + (actualSet.has(n) ? 1 : 0), 0));
  for (const h of hits) { tally.hist[h]++; tally.games++; tally.totalHits += h; }
  tally.perDrawMean.push(mean(hits));
}

function summarize(name, tally) {
  const atLeast = k => tally.hist.slice(k).reduce((a, b) => a + b, 0);
  return {
    name,
    meanHits: tally.totalHits / (tally.games || 1),
    games: tally.games,
    ge3: atLeast(3), ge4: atLeast(4), ge5: atLeast(5), ge6: tally.hist[6],
    hist: tally.hist,
    perDrawMean: tally.perDrawMean,
  };
}

/* ------------------------------------------------------------------ 본체 */

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = JSON.parse(fs.readFileSync(path.join(root, 'data', 'draws.json'), 'utf8'));
  const draws = db.draws;
  const T = draws.length;

  const holdout = Math.max(1, Math.min(T - 50, opts.holdout));
  const start = T - holdout;
  const N = Math.max(1, opts.games);

  console.log('='.repeat(66));
  console.log('워크포워드 백테스트');
  console.log('='.repeat(66));
  console.log('전체 데이터   ' + T + '회차 (1~' + db.latest + ')');
  console.log('검증 구간     ' + draws[start][0] + '회 ~ ' + draws[T - 1][0] + '회 (' + holdout + '회차)');
  console.log('회차당 게임   ' + N + '게임');
  console.log('반감기        ' + opts.halfLife + '회차');
  if (opts.weights) console.log('가중치        ' + JSON.stringify(opts.weights));
  console.log('');

  const engine = newTally(), random = newTally(), filter = newTally();
  const rng = makeRng(987654321);
  const t0 = Date.now();

  for (let t = start; t < T; t++) {
    const prior = draws.slice(0, t);

    // look-ahead 방지. 이게 깨지면 백테스트 결과 전체가 무의미하다.
    if (prior.length !== t) throw new Error('prior 길이 오류');
    if (prior[prior.length - 1][0] >= draws[t][0]) {
      throw new Error('look-ahead 감지: prior에 ' + draws[t][0] + '회 이상이 들어 있다');
    }

    const stats = buildStats(prior, { halfLife: opts.halfLife });
    const scoring = scoreNumbers(stats, opts.weights || undefined);
    const games = generateGames(stats, scoring, N, {
      seed: draws[t][0], temperature: opts.temperature, useFilters: true,
    });

    const actual = draws[t].slice(2, 8);
    record(engine, games.map(g => g.nums), actual);
    record(random, randomGames(N, rng), actual);
    record(filter, filteredGames(N, rng), actual);

    // 진행 표시는 터미널일 때만. 파이프로 넘길 때 \r 이 결과에 섞이지 않게 한다.
    if (process.stdout.isTTY && (t - start + 1) % 50 === 0) {
      process.stdout.write('  ' + (t - start + 1) + '/' + holdout + ' 회차 처리\r');
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (process.stdout.isTTY) process.stdout.write(' '.repeat(40) + '\r');

  const E = summarize('엔진', engine);
  const R = summarize('무작위', random);
  const F = summarize('필터만', filter);

  console.log('--- 게임당 평균 적중 개수 ' + '-'.repeat(40));
  console.log('  이론적 기대값 (완전 무작위)   ' + (6 * 6 / 45).toFixed(4));
  for (const s of [E, R, F]) {
    console.log('  ' + s.name.padEnd(28) + s.meanHits.toFixed(4) + '   (' + s.games + '게임)');
  }

  console.log('');
  console.log('--- 적중 분포 ' + '-'.repeat(52));
  console.log('  적중수    ' + ['엔진', '무작위', '필터만'].map(x => x.padStart(9)).join(''));
  for (let h = 0; h <= 6; h++) {
    console.log('  ' + (h + '개').padEnd(10)
      + [E, R, F].map(s => String(s.hist[h]).padStart(9)).join(''));
  }
  console.log('  ' + '3개 이상'.padEnd(8) + [E, R, F].map(s => String(s.ge3).padStart(9)).join(''));
  console.log('  ' + '4개 이상'.padEnd(8) + [E, R, F].map(s => String(s.ge4).padStart(9)).join(''));
  console.log('  ' + '5개 이상'.padEnd(8) + [E, R, F].map(s => String(s.ge5).padStart(9)).join(''));
  console.log('  ' + '6개'.padEnd(10) + [E, R, F].map(s => String(s.ge6).padStart(9)).join(''));

  console.log('');
  console.log('--- 유의성 검정 (회차 단위 대응표본, n=' + holdout + ') ' + '-'.repeat(14));
  const tests = [
    ['엔진 − 무작위', pairedT(E.perDrawMean, R.perDrawMean)],
    ['엔진 − 필터만', pairedT(E.perDrawMean, F.perDrawMean)],
    ['필터만 − 무작위', pairedT(F.perDrawMean, R.perDrawMean)],
  ];
  let anySignificant = false;
  for (const [label, r] of tests) {
    const sig = Math.abs(r.t) >= 1.96;
    if (sig) anySignificant = true;
    console.log('  ' + label.padEnd(18)
      + '차이 ' + (r.diff >= 0 ? '+' : '') + r.diff.toFixed(4)
      + '  표준오차 ' + r.se.toFixed(4)
      + '  t = ' + r.t.toFixed(2)
      + '   ' + (sig ? '<- 유의 (|t| >= 1.96)' : '차이 없음'));
  }

  console.log('');
  console.log('--- 결론 ' + '-'.repeat(57));
  if (anySignificant) {
    console.log('  일부 비교에서 |t| >= 1.96 이 나왔다. 다만 검정을 3번 했으므로');
    console.log('  다중비교 보정을 감안하면 우연일 수 있다. holdout을 늘려 재확인할 것.');
  } else {
    console.log('  세 방법 사이에 통계적으로 유의한 차이가 없다.');
    console.log('  로또가 독립 시행이라는 점을 감안하면 예상된 결과다.');
    console.log('  이 엔진의 가치는 당첨 확률이 아니라, 근거를 설명할 수 있고');
    console.log('  같은 시드로 재현 가능한 번호 선택에 있다.');
  }
  console.log('');
  console.log('  소요 ' + elapsed + '초');
  console.log('='.repeat(66));
}

main();
