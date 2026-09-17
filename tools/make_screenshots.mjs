/**
 * make_screenshots.mjs — Play 스토어용 휴대전화 스크린샷을 만든다. `npm run screenshots`
 *
 * 왜 실기기 대신 이걸 쓰는가.
 * 이 앱은 Capacitor 가 네이티브 껍데기 안에서 dist/web 을 그대로 띄우는 구조다.
 * 즉 화면을 그리는 것은 처음부터 끝까지 이 HTML/CSS 이고, 네이티브가 덧그리는 것은
 * 하단 배너 광고뿐이다. 그런데 스토어 스크린샷에는 광고가 안 찍히는 편이 낫다.
 * 따라서 폰 크기로 렌더링한 웹 화면이 곧 '광고 없는 앱 화면' 이다.
 *
 * 규격: 1080x1920 (360x640 CSS 픽셀 x 3배). Play 의 9:16 세로 스크린샷 요건을 만족한다.
 * 시드를 고정하므로 몇 번을 돌려도 같은 번호가 찍힌다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'docs', 'store');
const SEED = '20260913';          // 고정 시드 — 스크린샷을 재현 가능하게 한다

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const shot = async (page, name) => {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  const { width, height } = await page.evaluate(() => ({
    width: window.innerWidth * devicePixelRatio, height: window.innerHeight * devicePixelRatio,
  }));
  console.log(`  ${name}  ${width}x${height}`);
};

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve(ROOT);
  const base = `http://127.0.0.1:${server.address().port}/`;

  const browser = await puppeteer.launch({ headless: true, args: ['--force-device-scale-factor=3'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 3 });

  console.log('스크린샷 생성 (1080x1920)');
  await page.goto(base, { waitUntil: 'networkidle0' });
  // 앱 부팅 완료 = 회차 수가 실제로 표시된 시점
  await page.waitForFunction(() => /\d+회차/.test(document.getElementById('dataStatus').textContent));

  // ① 생성 결과 — 번호와 '이 조합이 나올 확률' 이 함께 보이게
  await page.$eval('#seed', (el, v) => { el.value = v; el.dispatchEvent(new Event('input')); }, SEED);
  await page.$eval('#games', el => { el.value = '3'; el.dispatchEvent(new Event('input')); });
  await page.click('#generate');
  await page.waitForFunction(() => document.querySelectorAll('#results .game').length > 0);
  // 첫 게임 카드가 화면 위쪽에 오게 맞춘다. #results 기준으로 잡으면 계산 근거 블록이
  // 문장 중간에서 잘린 채로 찍혀서 스토어 이미지로 쓰기 곤란하다.
  await page.evaluate(() => {
    // 탭 바가 sticky 라 그 높이만큼 더 내려야 조 제목이 가려지지 않는다.
    // 이 보정이 없으면 위쪽에 이전 블록의 문장 끝이 탭 바 밑으로 겹쳐 찍힌다.
    const tabsBottom = document.querySelector('.tabs').getBoundingClientRect().bottom;
    const first = document.querySelector('#results .batch');
    window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY - tabsBottom - 8);
  });
  await new Promise(r => setTimeout(r, 400));
  await shot(page, 'screenshot-1-results.png');

  // ② 계산 근거 — 확률이 어떻게 나왔는지
  await page.evaluate(() => document.querySelector('.basis').scrollIntoView({ block: 'center' }));
  await new Promise(r => setTimeout(r, 400));
  await shot(page, 'screenshot-2-basis.png');

  // ③ 분석 탭 — 번호별 점수 차트
  await page.evaluate(() => {
    document.querySelectorAll('.tab')[1].click();
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => document.querySelectorAll('#scoreChart .bar-row').length === 45);
  await new Promise(r => setTimeout(r, 400));
  await shot(page, 'screenshot-3-analysis.png');

  await browser.close();
  server.close();
  console.log('완료:', OUT);
};

main().catch(e => { console.error(e); process.exit(1); });
