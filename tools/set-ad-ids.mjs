/**
 * set-ad-ids.mjs — AdMob 광고 ID 를 테스트/실제 사이에서 전환한다.
 *
 *   node tools/set-ad-ids.mjs status   지금 어느 쪽인지 출력
 *   node tools/set-ad-ids.mjs test     구글 공식 테스트 ID 로 되돌린다
 *   node tools/set-ad-ids.mjs live     admob.local.md 의 실제 ID 를 주입한다
 *
 * 왜 스크립트로 묶는가: 실제 ID 가 들어갈 곳이 두 군데다.
 *   1) js/monetize.js  의 LIVE_AD_UNITS  (배너 / 전면 광고 단위)
 *   2) strings.xml     의 admob_app_id   (앱 ID)
 * 하나는 JS 모듈이고 하나는 안드로이드 리소스라 서로를 모른다. 손으로 고치면
 * 한쪽만 바뀐 '엇갈린 상태' 가 생기는데, 이 상태는 조용히 망가진다.
 * 앱 ID 만 실제면 광고는 나오지만 수익이 0 이고, 광고 단위만 실제면 SDK 가
 * 초기화에 실패한다. 둘 중 어느 쪽도 실행 중에 에러로 드러나지 않는다.
 *
 * 실제 ID 는 저장소에 없다. admob.local.md 는 .gitignore 에 있으며, 공개 저장소에
 * 광고 단위 ID 가 노출되면 제3자가 자기 앱에 그 ID 를 넣어 부정 트래픽을 만들고
 * 그 결과 이쪽 AdMob 계정이 정지될 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MONETIZE = path.join(ROOT, 'js', 'monetize.js');
const STRINGS = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const LOCAL_MD = path.join(ROOT, 'admob.local.md');

/** 구글 공식 테스트 앱 ID. monetize.js 의 TEST_AD_UNITS 와 짝이다. */
const TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713';

/** LIVE_AD_UNITS 블록. 두 값을 캡처한다. */
const LIVE_UNITS_RE =
  /(const LIVE_AD_UNITS = \{\s*banner: ')([^']*)(',\s*interstitial: ')([^']*)('\s*,?\s*\};)/;
const APP_ID_RE = /(<string name="admob_app_id">)([^<]*)(<\/string>)/;

// ── admob.local.md 읽기 ──────────────────────────────────────────────
// 마크다운 표를 파싱하지 않고, 줄 단위로 '라벨 + ca-app-pub 토큰' 만 뽑는다.
// 표 서식이 바뀌어도 라벨과 ID 가 같은 줄에 있으면 계속 동작한다.
// 앱 ID 는 `~`, 광고 단위는 `/` 로 구분되므로 형태만 봐도 서로 구별된다.
function readLocalIds() {
  if (!fs.existsSync(LOCAL_MD)) return null;
  const ids = { appId: '', banner: '', interstitial: '' };
  for (const line of fs.readFileSync(LOCAL_MD, 'utf8').split(/\r?\n/)) {
    const appId = line.match(/ca-app-pub-\d+~\d+/);
    const unit = line.match(/ca-app-pub-\d+\/\d+/);
    if (appId && /앱 ID/.test(line)) ids.appId ||= appId[0];
    if (unit && /배너/.test(line)) ids.banner ||= unit[0];
    if (unit && /전면/.test(line)) ids.interstitial ||= unit[0];
  }
  return ids;
}

/**
 * live 로 전환하려는데 실제 ID 를 못 구한 경우의 정책.
 *
 * TODO(human): 이 함수의 본문을 구현한다.
 *
 * 여기서 갈리는 것은 "실제 ID 가 없는 릴리스 빌드" 를 허용하는가다.
 *   - 끊는다: problems 를 출력하고 process.exit(1). 테스트 광고가 프로덕션으로
 *     나가는 일은 절대 없지만, ID 파일이 없는 환경(CI, 새 PC)에서는 빌드가 멈춘다.
 *   - 계속한다: 경고만 찍고 'test' 를 반환. 빌드는 항상 성공하지만, 테스트 광고가
 *     박힌 AAB 가 프로덕션에 올라가도 아무도 모른다(수익 0, 원인 파악도 어렵다).
 *
 * @param {string[]} problems 사람이 읽을 문제 목록
 * @returns {'test'} 테스트 ID 로 대신 주입하고 계속하려면 'test' 를 반환한다
 */
function onMissingLiveIds(problems) {
  // TODO(human)
}

// ── 파일 쓰기 ────────────────────────────────────────────────────────
function replaceOnce(file, re, build) {
  const before = fs.readFileSync(file, 'utf8');
  if (!re.test(before)) {
    console.error('FAIL 형태가 바뀌어 찾지 못했다: ' + path.relative(ROOT, file));
    console.error('      ' + re);
    process.exit(1);
  }
  const after = before.replace(re, build);
  if (after !== before) fs.writeFileSync(file, after);
  return after !== before;
}

function apply(units, appId) {
  const a = replaceOnce(MONETIZE, LIVE_UNITS_RE,
    (_m, p1, _b, p3, _i, p5) => p1 + units.banner + p3 + units.interstitial + p5);
  const b = replaceOnce(STRINGS, APP_ID_RE, (_m, p1, _v, p3) => p1 + appId + p3);
  return a || b;
}

// ── 현재 상태 읽기 ──────────────────────────────────────────────────
function currentState() {
  const m = fs.readFileSync(MONETIZE, 'utf8').match(LIVE_UNITS_RE);
  const s = fs.readFileSync(STRINGS, 'utf8').match(APP_ID_RE);
  const units = { banner: m?.[2] ?? '', interstitial: m?.[4] ?? '' };
  const appId = s?.[2] ?? '';
  // monetize.js 의 USE_LIVE 와 같은 판정을 쓴다. 판정 기준이 두 개가 되면
  // 스크립트가 보는 모드와 앱이 실제로 쓰는 모드가 갈라질 수 있다.
  const jsLive = Boolean(units.banner);
  const nativeLive = Boolean(appId) && appId !== TEST_APP_ID;
  return { units, appId, jsLive, nativeLive, mixed: jsLive !== nativeLive };
}

function printState(label) {
  const s = currentState();
  const mode = s.mixed ? '엇갈림 (위험)' : s.jsLive ? 'live' : 'test';
  console.log(`${label} 모드: ${mode}`);
  console.log(`  배너      ${s.units.banner || '(비어 있음 → TEST_AD_UNITS 사용)'}`);
  console.log(`  전면      ${s.units.interstitial || '(비어 있음 → TEST_AD_UNITS 사용)'}`);
  console.log(`  앱 ID     ${s.appId}${s.appId === TEST_APP_ID ? '  ← 구글 테스트 앱 ID' : ''}`);
  if (s.mixed) {
    console.log('\n  광고 단위와 앱 ID 가 서로 다른 쪽을 가리킨다.');
    console.log('  `node tools/set-ad-ids.mjs test` 또는 `live` 로 한쪽에 맞춘다.');
  }
  return s;
}

// ── 진입점 ──────────────────────────────────────────────────────────
const cmd = process.argv[2] ?? 'status';

if (cmd === 'status') {
  const s = printState('현재');
  process.exit(s.mixed ? 1 : 0);
}

if (cmd === 'test') {
  const changed = apply({ banner: '', interstitial: '' }, TEST_APP_ID);
  console.log(changed ? '테스트 ID 로 되돌렸다.' : '이미 테스트 ID 다.');
  printState('현재');
  process.exit(0);
}

if (cmd === 'live') {
  const ids = readLocalIds();
  const problems = [];
  if (!ids) problems.push('admob.local.md 가 없다 (경로: ' + LOCAL_MD + ')');
  else {
    if (!ids.appId) problems.push("admob.local.md 에서 '앱 ID' 줄을 못 찾았다");
    if (!ids.banner) problems.push("admob.local.md 에서 '배너' 줄을 못 찾았다");
    if (!ids.interstitial) problems.push("admob.local.md 에서 '전면' 줄을 못 찾았다");
  }

  if (problems.length > 0) {
    const decision = onMissingLiveIds(problems);
    if (decision !== 'test') {
      console.error('onMissingLiveIds 가 아직 구현되지 않았다 (TODO(human)).');
      process.exit(1);
    }
    apply({ banner: '', interstitial: '' }, TEST_APP_ID);
    printState('현재');
    process.exit(0);
  }

  apply({ banner: ids.banner, interstitial: ids.interstitial }, ids.appId);
  printState('현재');
  console.log('\n실제 광고 ID 가 들어갔다. 이제부터 광고를 직접 누르면 안 된다.');
  console.log('본인이나 테스터의 클릭은 부정 클릭으로 집계되어 AdMob 계정이 영구 정지된다.');
  console.log('다음: android/app/build.gradle 의 versionCode 를 올리고 `npm run android:bundle`.');
  process.exit(0);
}

console.error('쓰는 법: node tools/set-ad-ids.mjs [status|test|live]');
process.exit(1);
