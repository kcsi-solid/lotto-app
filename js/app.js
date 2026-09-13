/**
 * app.js — 화면 구성과 이벤트 배선.
 * 계산은 전부 engine.js가 하고, 이 파일은 입력을 모아 넘기고 결과를 그린다.
 */
import {
  buildStats, scoreNumbers, generateGames, softmaxWeights, DEFAULT_FILTERS, CONST,
} from './engine.js';
import {
  loadSettings, saveSettings, loadApiKey, saveApiKey,
  maskKey, clearCachedDraws,
} from './store.js';
import { loadDraws, updateFromEndpoint, importJson } from './source.js';

const $ = id => document.getElementById(id);
const BATCH = 5;   // 결과를 5게임 단위로 끊어 보여준다 (요구사항)

let db = null;       // 회차 데이터베이스
let stats = null;    // buildStats 결과
let scoring = null;  // scoreNumbers 결과
let settings = loadSettings();
let lastGames = [];  // 마지막 생성 결과. 표시 옵션만 바뀔 때 다시 뽑지 않고 재렌더링한다.

/* ---------------------------------------------------------------- 유틸 */

function ballClass(n) {
  if (n <= 10) return 'b1';
  if (n <= 20) return 'b2';
  if (n <= 30) return 'b3';
  if (n <= 40) return 'b4';
  return 'b5';
}

function ballHtml(n, extra = '') {
  return '<span class="ball ' + ballClass(n) + ' ' + extra + '">' + n + '</span>';
}

/**
 * 이 모델이 각 번호를 고를 확률(%)을 구한다.
 *
 * softmax 가중치는 45개 번호에 대해 합이 1이다. 한 게임에서 6개를 뽑으므로
 * 6을 곱하면 "그 번호가 이번 조합에 들어갈 확률"이 된다. 균등할 때가 6/45 = 13.3%다.
 *
 * 주의: 이것은 '이 생성기가 그 번호를 고를 확률'이지 당첨 확률이 아니다.
 * 실제 당첨 확률은 45개 번호가 전부 13.3%로 같다. 화면에도 그렇게 적는다.
 */
function modelProbabilities() {
  const w = softmaxWeights(scoring.score, settings.temperature);
  const out = new Array(CONST.MAX_N + 1).fill(0);
  for (let n = CONST.MIN_N; n <= CONST.MAX_N; n++) {
    out[n] = Math.min(99.9, w[n] * CONST.PICK * 100);
  }
  return out;
}

/**
 * 조합 확률 = 6개 번호의 모델 확률을 모두 곱한 값 (0~1 사이의 분수).
 *
 * 주의: 곱셈은 6번의 추출이 서로 독립이라고 가정한다. 실제 로또는 비복원
 * 추출이라 이 값은 엄밀한 결합확률이 아니다. 조합끼리 비교하는 지표로 쓴다.
 */
function comboProbability(nums, prob) {
  let p = 1;
  for (const n of nums) p *= prob[n] / 100;
  return p;
}

/** 값의 크기에 따라 자릿수를 조절한다. 범위가 1%에서 1e-9%까지 벌어진다. */
function fmtComboProb(p) {
  const pct = p * 100;
  if (pct >= 1) return pct.toFixed(2) + '%';
  if (pct >= 0.01) return pct.toFixed(4) + '%';
  if (pct >= 0.000001) return pct.toFixed(7).replace(/0+$/, '') + '%';
  return pct.toExponential(2) + '%';
}

/** 균등 조합 대비 몇 배인지. 곱한 값 자체보다 이쪽이 읽힌다. */
function fmtRatio(r) {
  if (r >= 100) return Math.round(r).toLocaleString('ko-KR') + '배';
  if (r >= 10) return r.toFixed(1) + '배';
  if (r >= 1) return r.toFixed(2) + '배';
  return r.toFixed(3) + '배';
}

function setStatus(el, msg, kind = '') {
  el.textContent = msg;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

/**
 * 게임 수 입력값을 1~100으로 정리한다.
 * 빈 칸/숫자가 아닌 값만 기본값으로 되돌리고, 0이나 음수는 1로 붙인다.
 * (Number(v) || 5 로 쓰면 0이 falsy라 "0 입력 → 5게임"이라는 엉뚱한 결과가 나온다.)
 */
function normalizeGameCount(value, fallback = 5) {
  const text = String(value).trim();
  if (text === '') return fallback;
  const n = Number(text);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(100, Math.round(n)));
}

/* -------------------------------------------------------- 계산 다시하기 */

function recompute() {
  stats = buildStats(db.draws, { halfLife: settings.halfLife });
  scoring = scoreNumbers(stats, settings.weights);
}

/* ------------------------------------------------------------ 결과 그리기 */

/**
 * 조합 확률이 어떻게 나온 값인지 계산 근거를 보여준다.
 * 가중치와 temperature 는 현재 설정값을 그대로 읽어, 슬라이더를 움직이면
 * 표시된 식도 함께 바뀐다.
 */
function basisHtml(unitPct, evenCombo) {
  const w = settings.weights;
  const t = settings.temperature;
  return '<div class="basis">'
    + '<div class="basis-title">조합 확률 계산 근거</div>'
    + '<ol>'
    + '<li><b>번호 점수</b> = 빈도×' + w.freq.toFixed(2)
      + ' + 마르코프×' + w.markov.toFixed(2)
      + ' + 간격×' + w.gap.toFixed(2)
      + ' + 위치×' + w.position.toFixed(2)
      + ' <span class="basis-sub">(네 지표를 각각 z-표준화한 뒤 가중합)</span></li>'
    + '<li><b>번호 확률</b> = softmax(점수 ÷ ' + t.toFixed(1) + ') × 6'
      + ' <span class="basis-sub">45개 합이 6.0이 되고, 균등하면 '
      + unitPct.toFixed(1) + '%</span></li>'
    + '<li><b>조합 확률</b> = 6개 번호 확률을 모두 곱함'
      + ' <span class="basis-sub">균등 조합이면 (' + unitPct.toFixed(1) + '%)<sup>6</sup> = '
      + fmtComboProb(evenCombo) + '</span></li>'
    + '</ol>'
    + '<p class="basis-warn">곱셈은 6번의 추출이 <b>서로 독립</b>이라고 가정한 값입니다. '
    + '실제 로또는 비복원 추출이라 엄밀한 결합확률이 아니며, <b>조합끼리 비교하는 지표</b>로만 쓰세요. '
    + '실제 당첨 확률은 어떤 조합이든 1/8,145,060 = 0.0000123%로 같습니다.</p>'
    + '</div>';
}

function renderGames(games) {
  const box = $('results');
  lastGames = games;
  if (!games.length) { box.innerHTML = '<p class="empty">생성된 번호가 없습니다.</p>'; return; }

  const showProb = settings.showProb;
  const prob = showProb ? modelProbabilities() : null;
  const unitPct = CONST.PICK / CONST.MAX_N * 100;                    // 13.3%
  const evenCombo = Math.pow(CONST.PICK / CONST.MAX_N, CONST.PICK);  // (6/45)^6

  let html = '';
  if (showProb) html += basisHtml(unitPct, evenCombo);

  for (let start = 0; start < games.length; start += BATCH) {
    const chunk = games.slice(start, start + BATCH);
    const groupNo = Math.floor(start / BATCH) + 1;
    html += '<div class="batch">';
    html += '<div class="batch-head"><strong>' + groupNo + '조 · '
          + (start + 1) + '~' + (start + chunk.length) + '게임</strong>'
          + '<span>' + chunk.length + '게임</span></div>';
    chunk.forEach((g, i) => {
      html += '<div class="game">'
        + '<div class="game-top">'
        + '<span class="game-no">' + String.fromCharCode(65 + i) + '</span>'
        + '<span class="balls">' + g.nums.map(n => ballHtml(n)).join('') + '</span>'
        + '</div>';
      if (showProb) {
        const p = comboProbability(g.nums, prob);
        html += '<div class="game-foot">'
          + '<span class="combo-p">' + fmtComboProb(p) + '</span>'
          + '<span class="combo-x">균등 대비 ' + fmtRatio(p / evenCombo) + '</span>'
          + '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  }
  html += '<div class="copy-row">'
        + '<button id="copyAll" class="btn">전체 복사</button>'
        + '<button id="downloadAll" class="btn btn-ghost">텍스트로 저장</button>'
        + '</div>';
  box.innerHTML = html;

  const asText = () => games
    .map((g, i) => String(i + 1).padStart(3) + '게임  ' + g.nums.map(n => String(n).padStart(2)).join('  '))
    .join('\n');

  // 주의: 복사/저장 결과에는 API 키나 설정값을 절대 포함하지 않는다. 번호만 나간다.
  $('copyAll').onclick = async () => {
    try {
      await navigator.clipboard.writeText(asText());
      $('copyAll').textContent = '복사됨';
      setTimeout(() => { $('copyAll').textContent = '전체 복사'; }, 1500);
    } catch {
      $('copyAll').textContent = '복사 실패';
    }
  };
  $('downloadAll').onclick = () => {
    const blob = new Blob([asText()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lotto-' + (db.latest + 1) + '회.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
}

function renderAnalysis() {
  // 점수 막대 (1~45 전부)
  const score = scoring.score;
  let max = 0;
  for (let n = 1; n <= CONST.MAX_N; n++) max = Math.max(max, Math.abs(score[n]));
  let html = '';
  for (let n = 1; n <= CONST.MAX_N; n++) {
    const v = score[n];
    const pct = max > 0 ? Math.abs(v) / max * 100 : 0;
    html += '<div class="bar-row">'
      + '<span class="bar-num">' + n + '</span>'
      + '<span class="bar-track"><span class="bar-fill' + (v < 0 ? ' neg' : '')
      + '" style="width:' + pct.toFixed(1) + '%"></span></span>'
      + '<span class="bar-val">' + v.toFixed(2) + '</span>'
      + '</div>';
  }
  $('scoreChart').innerHTML = html;

  // 지표별 상위 5개
  const labels = {
    freq: '출현 빈도', markov: '마르코프 전이', gap: '간격(밀린 정도)', position: '위치 분포',
  };
  const grid = Object.keys(labels).map(k => {
    const arr = scoring.parts[k];
    const top = Array.from({ length: CONST.MAX_N }, (_, i) => i + 1)
      .sort((a, b) => arr[b] - arr[a]).slice(0, 5);
    return '<div><h4>' + labels[k] + '</h4><p>' + top.join(' · ') + '</p></div>';
  }).join('');
  $('featureTop').innerHTML = grid;

  // 최근 10회차
  const recent = db.draws.slice(-10).reverse().map(r =>
    '<div class="recent-row"><span class="rno">' + r[0] + '회 ' + r[1] + '</span>'
    + r.slice(2, 8).map(n => ballHtml(n)).join('')
    + ballHtml(r[8], 'bonus') + '</div>'
  ).join('');
  $('recentDraws').innerHTML = recent;

  const f = DEFAULT_FILTERS;
  $('filterExplain').textContent =
    '1~' + db.latest + '회차 실측 분포에서 뽑은 임계값을 씁니다. '
    + '합계 ' + f.sumMin + '~' + f.sumMax + ' (실측 p10~p90), '
    + '홀수 ' + f.oddMin + '~' + f.oddMax + '개 (82%), '
    + '연속 번호 최대 ' + f.maxConsecutive + '개 (95%), '
    + '5개 구간 중 ' + f.minBands + '개 이상에 분산 (97%). '
    + '과거 1등 조합과 완전히 같은 조합도 제외합니다. '
    + '이 범위 밖이 "불가능"한 것이 아니라 "역사적으로 드물다"는 뜻입니다.';
}

function renderDataStatus() {
  const where = db.origin === 'cache' ? '갱신본' : '동봉본';
  setStatus($('dataStatus'),
    '1~' + db.latest + '회차 · ' + db.count + '건 · ' + where
    + ' · 다음 예상 회차 ' + (db.latest + 1) + '회');
}

/* ------------------------------------------------------------ 설정 배선 */

const SLIDERS = [
  ['wFreq', 'wFreqVal', v => { settings.weights.freq = v; }, 2],
  ['wMarkov', 'wMarkovVal', v => { settings.weights.markov = v; }, 2],
  ['wGap', 'wGapVal', v => { settings.weights.gap = v; }, 2],
  ['wPos', 'wPosVal', v => { settings.weights.position = v; }, 2],
  ['halfLife', 'halfLifeVal', v => { settings.halfLife = v; }, 0],
  ['temperature', 'tempVal', v => { settings.temperature = v; }, 1],
];

function syncSettingsToForm() {
  $('games').value = settings.games;
  $('seed').value = settings.seed || '';
  $('useFilters').checked = settings.useFilters;
  $('showProb').checked = settings.showProb;
  $('endpoint').value = settings.endpoint;
  $('authHeader').value = settings.authHeader;
  $('authScheme').value = settings.authScheme;
  $('wFreq').value = settings.weights.freq;
  $('wMarkov').value = settings.weights.markov;
  $('wGap').value = settings.weights.gap;
  $('wPos').value = settings.weights.position;
  $('halfLife').value = settings.halfLife;
  $('temperature').value = settings.temperature;
  for (const [id, valId, , digits] of SLIDERS) {
    $(valId).textContent = Number($(id).value).toFixed(digits);
  }
  setStatus($('keyStatus'), '저장된 키: ' + maskKey(loadApiKey()));
}

function wireSettings() {
  for (const [id, valId, apply, digits] of SLIDERS) {
    $(id).addEventListener('input', () => {
      const v = Number($(id).value);
      $(valId).textContent = v.toFixed(digits);
      apply(v);
      saveSettings(settings);
      recompute();
      renderAnalysis();
    });
  }

  $('games').addEventListener('change', () => {
    const v = normalizeGameCount($('games').value, settings.games);
    $('games').value = v;
    settings.games = v;
    saveSettings(settings);
  });
  $('seed').addEventListener('change', () => {
    settings.seed = $('seed').value.trim();
    saveSettings(settings);
  });
  $('useFilters').addEventListener('change', () => {
    settings.useFilters = $('useFilters').checked;
    saveSettings(settings);
  });
  $('endpoint').addEventListener('change', () => {
    settings.endpoint = $('endpoint').value.trim();
    saveSettings(settings);
  });
  $('authHeader').addEventListener('change', () => {
    settings.authHeader = $('authHeader').value.trim() || 'Authorization';
    saveSettings(settings);
  });
  $('authScheme').addEventListener('change', () => {
    settings.authScheme = $('authScheme').value.trim();
    saveSettings(settings);
  });

  // --- API 키 ---
  $('saveKey').onclick = () => {
    const v = $('apiKey').value;
    if (!v) { setStatus($('keyStatus'), '입력된 키가 없습니다.', 'err'); return; }
    const ok = saveApiKey(v);
    $('apiKey').value = '';
    $('apiKey').type = 'password';
    $('toggleKey').textContent = '보기';
    setStatus($('keyStatus'),
      ok ? '이 기기에만 저장했습니다: ' + maskKey(v) : '브라우저 저장소를 쓸 수 없습니다.',
      ok ? 'ok' : 'err');
  };
  $('toggleKey').onclick = () => {
    const el = $('apiKey');
    const show = el.type === 'password';
    el.type = show ? 'text' : 'password';
    $('toggleKey').textContent = show ? '가리기' : '보기';
    if (show && !el.value) el.value = loadApiKey();
  };
  $('deleteKey').onclick = () => {
    saveApiKey('');
    $('apiKey').value = '';
    setStatus($('keyStatus'), '키를 삭제했습니다.', 'ok');
  };

  // --- 데이터 갱신 ---
  $('updateData').onclick = async () => {
    const btn = $('updateData');
    btn.disabled = true;
    setStatus($('updateStatus'), '확인 중…');
    try {
      const { db: next, added } = await updateFromEndpoint(db, {
        endpoint: settings.endpoint,
        apiKey: loadApiKey(),
        authHeader: settings.authHeader,
        authScheme: settings.authScheme,
        onProgress: n => setStatus($('updateStatus'), n + '회차 확인 중…'),
      });
      if (added > 0) {
        db = next;
        recompute();
        renderDataStatus();
        renderAnalysis();
        setStatus($('updateStatus'), added + '개 회차를 추가했습니다. 최신 ' + db.latest + '회.', 'ok');
      } else {
        setStatus($('updateStatus'), '이미 최신입니다 (' + db.latest + '회).', 'ok');
      }
    } catch (e) {
      setStatus($('updateStatus'), '실패: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
    }
  };

  $('importFile').addEventListener('change', async ev => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      db = importJson(await file.text());
      recompute();
      renderDataStatus();
      renderAnalysis();
      setStatus($('importStatus'), db.count + '개 회차를 가져왔습니다. 최신 ' + db.latest + '회.', 'ok');
    } catch (e) {
      setStatus($('importStatus'), '실패: ' + e.message, 'err');
    } finally {
      ev.target.value = '';
    }
  });

  $('resetAll').onclick = async () => {
    saveSettings({});
    clearCachedDraws();
    settings = loadSettings();
    db = await loadDraws();
    syncSettingsToForm();
    recompute();
    renderDataStatus();
    renderAnalysis();
  };
}

function wireTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(b => {
        const on = b === btn;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', String(on));
      });
      document.querySelectorAll('.panel').forEach(p => {
        p.classList.toggle('is-active', p.id === 'panel-' + btn.dataset.tab);
      });
      window.scrollTo(0, 0);
    };
  });
}

/** 결과 영역을 생성 전 상태로 되돌린다. 설정과 데이터는 건드리지 않는다. */
function clearResults(alsoSeed = true) {
  $('results').innerHTML = '<p class="empty">게임 수를 정하고 번호 생성을 누르세요.</p>';
  lastGames = [];
  if (alsoSeed) {
    $('seed').value = '';
    settings.seed = '';
    saveSettings(settings);
  }
}

function wireGenerate() {
  $('reset').onclick = () => {
    clearResults(true);
    $('reset').textContent = '초기화됨';
    setTimeout(() => { $('reset').textContent = '초기화'; }, 1200);
  };

  $('showProb').addEventListener('change', () => {
    settings.showProb = $('showProb').checked;
    saveSettings(settings);
    if (lastGames.length) renderGames(lastGames);   // 다시 뽑지 않고 표시만 바꾼다
  });

  $('generate').onclick = () => {
    const count = normalizeGameCount($('games').value, settings.games);
    $('games').value = count;
    settings.games = count;
    settings.seed = $('seed').value.trim();
    settings.useFilters = $('useFilters').checked;
    saveSettings(settings);

    const seedText = settings.seed;
    const seed = seedText ? (Number(seedText) || hashString(seedText)) : undefined;
    const games = generateGames(stats, scoring, count, {
      seed,
      temperature: settings.temperature,
      useFilters: settings.useFilters,
    });
    renderGames(games);
  };
}

/** 숫자가 아닌 시드 문자열도 쓸 수 있게 32비트 해시로 바꾼다. */
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ---------------------------------------------------------------- 시작 */

async function main() {
  wireTabs();
  try {
    db = await loadDraws();
  } catch (e) {
    setStatus($('dataStatus'), '데이터를 불러오지 못했습니다: ' + e.message, 'err');
    $('generate').disabled = true;
    return;
  }
  syncSettingsToForm();
  wireSettings();
  wireGenerate();
  recompute();
  renderDataStatus();
  renderAnalysis();
  clearResults(false);   // 시작 시에는 저장된 시드를 지우지 않는다

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시는 없어도 앱은 동작한다 */ });
  }
}

main();
