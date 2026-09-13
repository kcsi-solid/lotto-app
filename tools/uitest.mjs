/**
 * uitest.mjs — index.html + app.js 를 실제 DOM(jsdom)에서 구동해 UI 배선을 검증한다.
 * 문법 검사로는 잡히지 않는 null 참조, 잘못된 id, 이벤트 미연결을 잡는 것이 목적이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const APP = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost:8000/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

// --- 브라우저 API 셰임 -------------------------------------------------
// jsdom이 진짜 localStorage를 주므로 그대로 쓰고, 검사용 래퍼만 만든다.
const store = {
  has: k => window.localStorage.getItem(k) !== null,
  get: k => window.localStorage.getItem(k),
};
const def = (obj, key, value) =>
  Object.defineProperty(obj, key, { value, writable: true, configurable: true });

def(window, 'fetch', async (url) => {
  const rel = String(url).replace('http://localhost:8000/', '');
  const file = path.join(APP, rel);
  if (!fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
  const text = fs.readFileSync(file, 'utf8');
  return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
});
def(window.navigator, 'clipboard', { writeText: async () => {} });
def(window, 'scrollTo', () => {});   // jsdom 미구현. 실제 브라우저에서는 정상 동작한다.
def(window.URL, 'createObjectURL', () => 'blob:test');
def(window.URL, 'revokeObjectURL', () => {});

for (const k of ['document', 'window', 'navigator', 'localStorage', 'fetch',
                 'Blob', 'URL', 'HTMLElement', 'Event', 'CustomEvent']) {
  if (window[k] !== undefined) def(globalThis, k, window[k]);
}
def(globalThis, 'document', window.document);
def(globalThis, 'window', window);

// --- app.js 구동 -------------------------------------------------------
console.log('[1] 앱 부팅');
await import(pathToFileURL(path.join(APP, 'js/app.js')).href);
await new Promise(r => setTimeout(r, 400));   // main()의 async 완료 대기

const $ = id => window.document.getElementById(id);
check('런타임 오류 없음', errors.length === 0, errors.join(' | '));
check('데이터 상태 표시됨', /\d+회차/.test($('dataStatus').textContent), $('dataStatus').textContent);
check('생성 버튼 활성', !$('generate').disabled);

console.log('\n[2] 초기 렌더링');
check('점수 차트 45줄', $('scoreChart').querySelectorAll('.bar-row').length === 45,
  String($('scoreChart').querySelectorAll('.bar-row').length));
check('지표별 상위 4칸', $('featureTop').querySelectorAll('h4').length === 4);
check('최근 회차 10줄', $('recentDraws').querySelectorAll('.recent-row').length === 10);
check('필터 설명 채워짐', $('filterExplain').textContent.includes('합계'));
check('결과 영역 안내문', $('results').textContent.includes('번호 생성'));

console.log('\n[3] 번호 생성 — 5게임');
$('games').value = '5';
$('seed').value = '20260913';
$('generate').click();
let batches = $('results').querySelectorAll('.batch');
let games = $('results').querySelectorAll('.game');
check('5게임 생성됨', games.length === 5, String(games.length));
check('5게임 단위 구분 = 1조', batches.length === 1, String(batches.length));
check('각 게임 공 6개', [...games].every(g => g.querySelectorAll('.ball').length === 6));
check('공 번호가 1~45', [...games].every(g =>
  [...g.querySelectorAll('.ball')].every(b => +b.textContent >= 1 && +b.textContent <= 45)));
check('복사/저장 버튼 존재', !!$('copyAll') && !!$('downloadAll'));

console.log('\n[4] 5게임 단위 구분 — 12게임');
$('games').value = '12';
$('generate').click();
batches = $('results').querySelectorAll('.batch');
games = $('results').querySelectorAll('.game');
const heads = [...batches].map(b => b.querySelector('.batch-head strong').textContent.trim());
check('12게임 생성됨', games.length === 12, String(games.length));
check('3개 조로 분할 (5+5+2)', batches.length === 3, String(batches.length));
check('조 라벨이 범위를 정확히 표시', heads.join(' / '), heads.join(' / '));
const sizes = [...batches].map(b => b.querySelectorAll('.game').length);
check('조별 게임 수 [5,5,2]', JSON.stringify(sizes) === '[5,5,2]', JSON.stringify(sizes));

console.log('\n[5] 시드 재현성 (UI 경로)');
$('games').value = '5'; $('seed').value = 'abc';
$('generate').click();
const first = $('results').textContent;
$('generate').click();
check('같은 시드 → 같은 결과', first === $('results').textContent);
$('seed').value = 'xyz';
$('generate').click();
check('다른 시드 → 다른 결과', first !== $('results').textContent);

console.log('\n[6] 설정 반영');
$('halfLife').value = '60';
$('halfLife').dispatchEvent(new window.Event('input'));
check('반감기 라벨 갱신', $('halfLifeVal').textContent === '60', $('halfLifeVal').textContent);
check('반감기 변경 후에도 차트 유지', $('scoreChart').querySelectorAll('.bar-row').length === 45);
$('wMarkov').value = '1';
$('wMarkov').dispatchEvent(new window.Event('input'));
check('가중치 라벨 갱신', $('wMarkovVal').textContent === '1.00', $('wMarkovVal').textContent);
check('설정이 저장소에 기록됨', store.has('lotto.settings.v1'));

console.log('\n[7] API 키 취급');
$('apiKey').value = 'sk-test-SECRET-1234567890';
$('saveKey').click();
check('키가 저장됨', store.get('lotto.apikey.v1') === 'sk-test-SECRET-1234567890');
check('키가 마스킹되어 표시', $('keyStatus').textContent.includes('•')
  && !$('keyStatus').textContent.includes('SECRET'), $('keyStatus').textContent);
check('입력칸이 비워짐', $('apiKey').value === '');
const settingsBlob = store.get('lotto.settings.v1');
check('설정 저장소에 키가 섞이지 않음', !settingsBlob.includes('SECRET'));
$('generate').click();
check('생성 결과에 키가 노출되지 않음', !$('results').textContent.includes('SECRET'));
$('deleteKey').click();
check('키 삭제됨', !store.has('lotto.apikey.v1'));

console.log('\n[8] 탭 전환');
const tabs = [...window.document.querySelectorAll('.tab')];
tabs[1].click();
check('분석 탭 활성', $('panel-analysis').classList.contains('is-active')
  && !$('panel-generate').classList.contains('is-active'));
check('aria-selected 갱신', tabs[1].getAttribute('aria-selected') === 'true'
  && tabs[0].getAttribute('aria-selected') === 'false');
tabs[2].click();
check('설정 탭 활성', $('panel-settings').classList.contains('is-active'));

console.log('\n[9] 경계값');
$('games').value = '0';
$('generate').click();
check('0 입력 → 1게임으로 보정', $('results').querySelectorAll('.game').length === 1,
  String($('results').querySelectorAll('.game').length));
$('games').value = '999';
$('generate').click();
const many = $('results').querySelectorAll('.game').length;
check('999 입력 → 100게임으로 제한', many === 100, String(many));
check('100게임 → 20개 조', $('results').querySelectorAll('.batch').length === 20,
  String($('results').querySelectorAll('.batch').length));

check('전 과정 런타임 오류 없음', errors.length === 0, errors.join(' | '));

console.log('\n결과: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
