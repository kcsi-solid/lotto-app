/**
 * disttest.mjs — dist/ 산출물 검증. `npm run test:dist`
 *
 * 특히 중요한 것: 단일 파일이 file:// 에서 진짜로 동작하는가.
 * 그래서 fetch 와 서버를 아예 주지 않고, 오프라인 파일처럼 열어서 확인한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('[1] 산출물 존재');
const expected = [
  'web/index.html', 'web/privacy.html', 'web/css/app.css',
  'web/js/app.js', 'web/js/engine.js', 'web/js/store.js', 'web/js/source.js',
  // Capacitor 의 webDir 이 dist/web 이라 네이티브 앱이 여기서 monetize.js 를 동적 import 한다.
  // 빠지면 실기기에서 404 가 나므로 산출물 검사로 지킨다.
  'web/js/monetize.js',
  'web/data/draws.json',
  'web/manifest.webmanifest', 'web/sw.js', 'web/icons/icon.svg',
  'lotto-standalone.html', 'android/README.md', 'BUILD.txt',
];
for (const f of expected) {
  check(f, fs.existsSync(path.join(DIST, f)));
}
check('lotto-app-web.zip', fs.existsSync(path.join(DIST, 'lotto-app-web.zip')));

console.log('\n[2] 단일 파일 자급자족 확인');
const single = fs.readFileSync(path.join(DIST, 'lotto-standalone.html'), 'utf8');
check('외부 CSS 참조 없음', !single.includes('href="css/'));
check('외부 JS 참조 없음', !single.includes('src="js/'));
check('외부 데이터 fetch 없음', !single.includes("fetch('data/draws.json'"));
check('type="module" 없음 (file:// 에서 막힘)', !single.includes('type="module"'));
check('import/export 문 없음', !/^\s*(import|export)\s/m.test(single));
check('데이터가 박혀 있음', single.includes('EMBEDDED_DRAWS'));
check('1241회차 포함', single.includes('"latest":1241') || /latest"?\s*:\s*1241/.test(single));
// 오프라인 동작을 깨는 것은 "페이지를 열 때 불러오는" 외부 자원이다.
// src/href 로 외부 호스트를 가리키는 것이 없어야 한다.
const externalRefs = [...single.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
check('페이지가 불러오는 외부 자원 없음', externalRefs.length === 0, externalRefs.join(', '));

// 코드에 남는 외부 URL 은 설정의 기본 갱신 엔드포인트 하나뿐이어야 한다.
// 이것은 사용자가 '최신 회차 가져오기'를 눌렀을 때만 쓰이므로 오프라인에 영향이 없다.
const urls = [...new Set([...single.matchAll(/https?:\/\/[^"'\s)<]+/g)].map(m => m[0]))];
check('남은 외부 URL 은 갱신 엔드포인트뿐',
  urls.length === 1 && urls[0].includes('{draw}'), urls.join(', '));

console.log('\n[3] 단일 파일 실제 구동 (fetch 없이, file:// 흉내)');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(single, {
  url: pathToFileURL(path.join(DIST, 'lotto-standalone.html')).href,
  runScripts: 'dangerously',       // 파일 안의 <script> 를 그대로 실행
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;
// fetch 를 주지 않는다. 단일 파일이 정말 자급자족인지 보기 위해서다.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
await new Promise(r => setTimeout(r, 600));

const $ = id => window.document.getElementById(id);
check('스크립트 실행 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));
check('데이터 로드됨 (fetch 없이)', /\d+회차/.test($('dataStatus')?.textContent || ''),
  $('dataStatus')?.textContent);
check('1~1241회 인식', ($('dataStatus')?.textContent || '').includes('1241'));
check('분석 차트 45줄', $('scoreChart')?.querySelectorAll('.bar-row').length === 45,
  String($('scoreChart')?.querySelectorAll('.bar-row').length));
check('최근 회차 10줄', $('recentDraws')?.querySelectorAll('.recent-row').length === 10);

$('games').value = '7';
$('generate').click();
check('번호 생성 동작', $('results').querySelectorAll('.game').length === 7,
  String($('results').querySelectorAll('.game').length));
check('5게임 단위 구분', $('results').querySelectorAll('.batch').length === 2);
check('조합 확률 표시', $('results').querySelectorAll('.combo-p').length === 7);
check('계산 근거 표시', $('results').querySelector('.basis') !== null);
$('reset').click();
check('초기화 버튼 동작', $('results').querySelectorAll('.game').length === 0);
check('전 과정 오류 없음', errors.length === 0, errors.slice(0, 2).join(' | '));

console.log('\n[4] 웹 배포본');
const webIndex = fs.readFileSync(path.join(DIST, 'web/index.html'), 'utf8');
check('index.html 이 상대 경로만 사용', !/(src|href)="\//.test(webIndex));
check('manifest 연결됨', webIndex.includes('manifest.webmanifest'));
check('서비스 워커 등록 코드 포함',
  fs.readFileSync(path.join(DIST, 'web/js/app.js'), 'utf8').includes("register('sw.js')"));
const webDb = JSON.parse(fs.readFileSync(path.join(DIST, 'web/data/draws.json'), 'utf8'));
const srcDb = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/draws.json'), 'utf8'));
check('데이터가 원본과 동일', JSON.stringify(webDb.draws) === JSON.stringify(srcDb.draws));

console.log('\n결과: ' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
