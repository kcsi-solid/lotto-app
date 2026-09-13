/**
 * build.mjs — 배포 산출물을 dist/ 에 만든다. `npm run build`
 *
 * 만드는 것
 *   dist/web/                  웹 호스팅용 정적 파일 (그대로 업로드)
 *   dist/lotto-app-web.zip     위 폴더를 압축한 것
 *   dist/lotto-standalone.html 서버 없이 file:// 로 열리는 단일 파일
 *   dist/android/              Capacitor 안드로이드 빌드 안내
 *
 * 단일 파일을 만들 때의 제약
 *   file:// 에서는 ES 모듈 import 와 fetch 가 CORS 로 막힌다. 그래서
 *   import/export 를 걷어내고 클래식 스크립트 하나로 합치며,
 *   data/draws.json 은 코드 안에 직접 박아넣고 fetch 호출을 치환한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const log = (...a) => console.log(' ', ...a);

/* ------------------------------------------------------------ 웹 배포본 */

const WEB_FILES = [
  'index.html', 'privacy.html', 'manifest.webmanifest', 'sw.js',
  'css/app.css',
  'js/app.js', 'js/engine.js', 'js/store.js', 'js/source.js',
  // monetize.js 는 웹에서 절대 불리지 않지만 반드시 여기 있어야 한다.
  // Capacitor 안드로이드 앱의 webDir 이 이 폴더라서, 빠지면 네이티브에서 동적 import 가 404 난다.
  'js/monetize.js',
  'data/draws.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

function buildWeb() {
  const out = path.join(DIST, 'web');
  fs.rmSync(out, { recursive: true, force: true });
  let bytes = 0;
  for (const f of WEB_FILES) {
    const src = path.join(ROOT, f);
    const dst = path.join(out, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    bytes += fs.statSync(dst).size;
  }
  log(`dist/web/  ${WEB_FILES.length}개 파일, ${(bytes / 1024).toFixed(0)}KB`);
  return out;
}

/* ------------------------------------------------------------ zip 압축본 */

/*
 * dist/web/ 을 zip 하나로 묶는다. Netlify 처럼 폴더를 드래그앤드롭 받는 곳에 쓴다.
 *
 * 외부 의존성을 들이지 않으려고 zip 포맷을 직접 쓴다. node:zlib 의 deflateRaw 가
 * 그대로 zip 의 압축 방식(method 8)이라 실제로 필요한 것은 헤더 몇 줄과 CRC32 뿐이다.
 * zip64 나 암호화는 쓰지 않는다 — 산출물이 수백 KB 라 걸릴 일이 없다.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** JS Date 를 MS-DOS 의 2초 단위 시각·날짜 필드로 바꾼다. */
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function buildZip(webDir) {
  const { time, date } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const rel of WEB_FILES) {
    const raw = fs.readFileSync(path.join(webDir, rel));
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    // 압축이 오히려 커지는 파일(이미 압축된 png 등)은 그냥 저장한다.
    const store = deflated.length >= raw.length;
    const body = store ? raw : deflated;
    const method = store ? 0 : 8;
    const name = Buffer.from(rel.split(path.sep).join('/'), 'utf8');
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // 필요 버전 2.0
    local.writeUInt16LE(0x0800, 6);      // 파일명이 UTF-8 임을 표시
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // 만든 버전
    central.writeUInt16LE(20, 6);        // 필요 버전
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 38);        // 외부 속성
    central.writeUInt32LE(offset, 42);   // 이 항목의 로컬 헤더 위치
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(WEB_FILES.length, 8);
  end.writeUInt16LE(WEB_FILES.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);

  const out = path.join(DIST, 'lotto-app-web.zip');
  fs.writeFileSync(out, Buffer.concat([...locals, cd, end]));
  log(`dist/lotto-app-web.zip  ${(fs.statSync(out).size / 1024).toFixed(0)}KB (${WEB_FILES.length}개 파일)`);
  return out;
}

/* -------------------------------------------------- 단일 파일 (오프라인) */

/** ES 모듈을 클래식 스크립트에 넣을 수 있게 import/export 를 걷어낸다. */
function stripModuleSyntax(code) {
  return code
    // import { a, b } from './x.js';  (여러 줄에 걸친 것 포함)
    .replace(/^import\s+[\s\S]*?from\s+'[^']+';[ \t]*\r?\n/gm, '')
    // export function / export const / export async function
    .replace(/^export\s+/gm, '');
}

function buildStandalone() {
  const draws = read('data/draws.json');
  const css = read('css/app.css');
  const iconSvg = read('icons/icon.svg');

  // 의존 순서대로 합친다: engine <- store <- source <- app
  let source = stripModuleSyntax(read('js/source.js'));

  // file:// 에서는 fetch 가 막히므로 번들 데이터를 코드에서 직접 읽게 바꾼다
  const fetchCall = `const res = await fetch('data/draws.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('번들 데이터를 읽지 못했습니다 (HTTP ' + res.status + ')');
  const bundled = await res.json();`;
  if (!source.includes(fetchCall)) {
    throw new Error('loadDraws() 의 fetch 호출을 찾지 못했습니다. source.js 가 바뀌었는지 확인하세요.');
  }
  source = source.replace(fetchCall, 'const bundled = EMBEDDED_DRAWS;');

  const script = [
    'const EMBEDDED_DRAWS = ' + draws + ';',
    stripModuleSyntax(read('js/engine.js')),
    stripModuleSyntax(read('js/store.js')),
    source,
    stripModuleSyntax(read('js/app.js')),
  ].join('\n\n');

  // 남은 모듈 문법이 있으면 클래식 스크립트에서 문법 오류가 난다. 미리 잡는다.
  for (const bad of [/^\s*import\s/m, /^\s*export\s/m]) {
    const hit = script.match(bad);
    if (hit) throw new Error('모듈 문법이 남아 있습니다: ' + hit[0].trim());
  }

  let html = read('index.html');

  // 단일 파일에는 privacy.html 이 딸려가지 않는다. 죽은 링크를 남기지 않는다.
  const privacyLink = '  <p><a href="privacy.html">개인정보처리방침</a></p>\n';
  if (!html.includes(privacyLink)) {
    throw new Error('index.html 의 개인정보처리방침 링크를 찾지 못했습니다.');
  }
  html = html
    .replace(privacyLink, '')
    .replace('<link rel="manifest" href="manifest.webmanifest">', '')
    .replace('<link rel="apple-touch-icon" href="icons/icon-180.png">', '')
    .replace('<link rel="icon" href="icons/icon.svg" type="image/svg+xml">',
      '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,'
      + Buffer.from(iconSvg, 'utf8').toString('base64') + '">')
    .replace('<link rel="stylesheet" href="css/app.css">', '<style>\n' + css + '\n</style>')
    .replace('<script type="module" src="js/app.js"></script>',
      '<script>\n(function () {\n' + script + '\n})();\n</script>');

  if (html.includes('src="js/app.js"') || html.includes('href="css/app.css"')
      || html.includes('href="privacy.html"')) {
    throw new Error('외부 참조가 남아 있습니다. index.html 구조가 바뀌었는지 확인하세요.');
  }

  const out = path.join(DIST, 'lotto-standalone.html');
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(out, html, 'utf8');
  log(`dist/lotto-standalone.html  ${(fs.statSync(out).size / 1024).toFixed(0)}KB (단일 파일)`);
  return out;
}

/* ------------------------------------------------------- 안드로이드 안내 */

function buildAndroid(siteUrl) {
  const dir = path.join(DIST, 'android');
  fs.mkdirSync(dir, { recursive: true });

  const guide = `# 안드로이드 앱 빌드 (Capacitor)

이 앱은 **Capacitor 로 감싼 네이티브 안드로이드 앱**으로 구글 플레이에 올립니다.
TWA(웹주소 래핑)를 쓰지 않는 이유는 하나입니다 — **TWA 안에서는 AdMob 광고를 띄울 수 없습니다.**
Chrome 이 화면 전체를 그려 네이티브 AdView 를 겹칠 수 없고, PWA 안에 AdSense 를 넣는 것은
'앱 내 AdSense 금지' 정책 위반입니다.

Capacitor 프로젝트는 저장소 루트의 \`android/\` 에 있습니다. 이 폴더는 참고 문서만 담습니다.

---

## 사전 준비 (한 번만)

\`\`\`powershell
winget install --id EclipseAdoptium.Temurin.21.JDK
winget install --id Google.AndroidStudio
\`\`\`

## 빌드

\`\`\`bash
npm run build          # dist/web/ 생성 — Capacitor 의 webDir 이다
npx cap sync android   # 웹 자산 + 네이티브 플러그인 동기화
npx cap run android    # 에뮬레이터/실기기에서 실행

cd android && ./gradlew bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab  (Play 제출용)
\`\`\`

> \`npm run build\` 를 먼저 돌리지 않으면 \`cap sync\` 가 **예전 dist/web 을 그대로 복사합니다.**
> 화면이 안 바뀌면 거의 항상 이것이 원인입니다.

## 출시 전 점검

1. \`js/monetize.js\` 의 \`LIVE_AD_UNITS\` 를 실제 AdMob 광고 단위 ID 로 채웠는가
   (비어 있으면 테스트 광고가 나갑니다 — 수익 0)
2. \`android/app/src/main/res/values/strings.xml\` 의 \`admob_app_id\` 가 실제 앱 ID 인가
3. 업로드 키스토어를 **백업**했는가 (잃으면 앱 업데이트가 영구 불가)
4. 개인정보처리방침 URL 이 살아 있고, Play 데이터 안전 양식과 내용이 일치하는가

## 아이폰

iOS 는 Mac + Xcode + 개발자 계정(연 $99)이 필요합니다.
**사파리에서 \`공유 → 홈 화면에 추가\`** 로 PWA 를 설치하는 것이 현실적인 대안입니다.
배포 주소: ${siteUrl}
`;
  fs.writeFileSync(path.join(dir, 'README.md'), guide, 'utf8');
  log('dist/android/  README.md (Capacitor 빌드 안내)');
}

/* ------------------------------------------------------------------ 본체 */

const siteUrl = process.argv.find(a => a.startsWith('--url='))?.slice(6)
  || 'https://<아이디>.github.io/lotto-app/';

console.log('배포 산출물 생성');
fs.mkdirSync(DIST, { recursive: true });
const webDir = buildWeb();
buildZip(webDir);
buildStandalone();
buildAndroid(siteUrl);

const db = JSON.parse(read('data/draws.json'));
fs.writeFileSync(path.join(DIST, 'BUILD.txt'),
  [
    '로또 번호 분석기 — 배포 산출물',
    '생성 시각: ' + new Date().toISOString(),
    '데이터: 1~' + db.latest + '회 (' + db.count + '건)',
    '',
    'web/                   웹 호스팅용. 폴더 내용을 그대로 업로드하세요.',
    'lotto-app-web.zip      위 폴더의 압축본.',
    'lotto-standalone.html  단일 파일. 서버 없이 열립니다. 핸드폰에 복사해 쓰세요.',
    'android/               Capacitor 안드로이드 빌드 안내.',
  ].join('\n'), 'utf8');

console.log('완료: ' + DIST);
