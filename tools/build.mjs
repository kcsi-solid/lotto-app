/**
 * build.mjs — 배포 산출물을 dist/ 에 만든다. `npm run build`
 *
 * 만드는 것
 *   dist/web/                  웹 호스팅용 정적 파일 (그대로 업로드)
 *   dist/lotto-app-web.zip     위 폴더를 압축한 것
 *   dist/lotto-standalone.html 서버 없이 file:// 로 열리는 단일 파일
 *   dist/android/              APK 빌드용 설정과 안내
 *
 * 단일 파일을 만들 때의 제약
 *   file:// 에서는 ES 모듈 import 와 fetch 가 CORS 로 막힌다. 그래서
 *   import/export 를 걷어내고 클래식 스크립트 하나로 합치며,
 *   data/draws.json 은 코드 안에 직접 박아넣고 fetch 호출을 치환한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const log = (...a) => console.log(' ', ...a);

/* ------------------------------------------------------------ 웹 배포본 */

const WEB_FILES = [
  'index.html', 'manifest.webmanifest', 'sw.js',
  'css/app.css',
  'js/app.js', 'js/engine.js', 'js/store.js', 'js/source.js',
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
  html = html
    .replace('<link rel="manifest" href="manifest.webmanifest">', '')
    .replace('<link rel="apple-touch-icon" href="icons/icon-180.png">', '')
    .replace('<link rel="icon" href="icons/icon.svg" type="image/svg+xml">',
      '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,'
      + Buffer.from(iconSvg, 'utf8').toString('base64') + '">')
    .replace('<link rel="stylesheet" href="css/app.css">', '<style>\n' + css + '\n</style>')
    .replace('<script type="module" src="js/app.js"></script>',
      '<script>\n(function () {\n' + script + '\n})();\n</script>');

  if (html.includes('src="js/app.js"') || html.includes('href="css/app.css"')) {
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

  const manifest = {
    packageId: 'kr.kcseo.lotto',
    host: siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
    name: '로또 번호 분석기',
    launcherName: '로또분석',
    display: 'standalone',
    themeColor: '#0d1117',
    navigationColor: '#0d1117',
    backgroundColor: '#0d1117',
    startUrl: '/',
    iconUrl: siteUrl.replace(/\/$/, '') + '/icons/icon-512.png',
    maskableIconUrl: siteUrl.replace(/\/$/, '') + '/icons/icon-512.png',
    appVersionName: '1.0.0',
    appVersionCode: 1,
    shortcuts: [],
    signingKey: { path: '', alias: '' },
    orientation: 'portrait',
    fallbackType: 'customtabs',
    enableNotifications: false,
  };
  fs.writeFileSync(path.join(dir, 'twa-manifest.json'),
    JSON.stringify(manifest, null, 2), 'utf8');

  const guide = `# 안드로이드 APK 만들기

이 PC에는 **JDK와 Android SDK가 없어서 APK를 직접 빌드하지 못했습니다.**
(\`java\`, \`gradle\`, \`ANDROID_HOME\` 모두 확인했으나 없음)

APK는 웹에 올린 주소가 있어야 만들 수 있습니다. 먼저 배포부터 하세요.

---

## 방법 1 — PWABuilder (설치 불필요, 가장 쉬움)

1. 사이트를 먼저 배포합니다 (\`dist/web/\` 을 GitHub Pages / Netlify / Vercel 에 업로드).
2. <https://www.pwabuilder.com> 에 접속해 배포한 주소를 입력합니다.
3. **Package For Stores → Android** 를 고릅니다.
4. \`Download\` 를 누르면 서명된 APK 와 AAB 가 담긴 zip 을 받습니다.
   - 테스트 설치용은 \`app-release-signed.apk\`
   - 구글 플레이 제출용은 \`.aab\`

받은 zip 안의 \`assetlinks.json\` 을 사이트의 \`/.well-known/assetlinks.json\` 경로에
올려야 주소창 없이 전체화면으로 뜹니다. 올리지 않으면 상단에 주소 막대가 남습니다.

## 방법 2 — Bubblewrap (로컬 빌드)

JDK 17 과 Android SDK 를 설치한 뒤:

\`\`\`bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest <배포주소>/manifest.webmanifest
bubblewrap build
\`\`\`

같은 폴더의 \`twa-manifest.json\` 을 참고용으로 넣어 뒀습니다.
\`host\`, \`iconUrl\`, \`packageId\` 를 실제 배포 주소와 원하는 패키지명으로 바꾸세요.

## 방법 3 — APK 없이 쓰기 (권장)

사실 APK가 꼭 필요하지 않습니다.

- **PWA 설치**: 배포 주소를 핸드폰 브라우저로 열고 \`홈 화면에 추가\`.
  아이콘으로 실행되고 주소창 없이 전체화면으로 뜨며, 오프라인에서도 동작합니다.
- **단일 파일**: \`dist/lotto-standalone.html\` 을 핸드폰에 복사해 브라우저로 엽니다.
  서버도 인터넷도 필요 없습니다.

## 아이폰

iOS 는 APK 개념이 없고, 앱스토어 배포에는 Mac + Xcode + 개발자 계정(연 $99)이 필요합니다.
**사파리에서 \`공유 → 홈 화면에 추가\`** 가 사실상 유일하고 충분한 방법입니다.
`;
  fs.writeFileSync(path.join(dir, 'README.md'), guide, 'utf8');
  log('dist/android/  twa-manifest.json + README.md');
}

/* ------------------------------------------------------------------ 본체 */

const siteUrl = process.argv.find(a => a.startsWith('--url='))?.slice(6)
  || 'https://<아이디>.github.io/lotto-app/';

console.log('배포 산출물 생성');
fs.mkdirSync(DIST, { recursive: true });
buildWeb();
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
    'android/               APK 만드는 방법.',
  ].join('\n'), 'utf8');

console.log('완료: ' + DIST);
