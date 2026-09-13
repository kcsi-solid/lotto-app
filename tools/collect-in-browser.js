/**
 * collect-in-browser.js — 동행복권에서 직접 회차 데이터를 받아오는 수집기.
 *
 * 왜 이 방식인가
 *   dhlottery.co.kr 은 봇 차단(NetFUNNEL 대기열)이 걸려 있어 curl/서버/다른 사이트에서
 *   호출하면 전부 대기열 페이지로 돌아간다. 하지만 정상 브라우저로 사이트에 들어가 있으면
 *   같은 출처(same-origin) 요청이라 CORS도, 봇 차단도 걸리지 않는다.
 *
 * 사용법
 *   1. 크롬에서 https://www.dhlottery.co.kr 을 연다 (대기열이 있으면 통과할 때까지 기다린다).
 *   2. F12 → Console 탭.
 *   3. 이 파일 내용을 통째로 붙여넣고 엔터.
 *   4. 끝나면 draws.json 이 자동으로 내려받아진다.
 *   5. 그 파일을 앱의 [설정] → [수동으로 가져오기]에서 넣거나,
 *      lotto-app/data/draws.json 을 통째로 교체한다.
 */
(async () => {
  const CONCURRENCY = 6;        // 너무 높이면 차단당한다
  const DELAY_MS = 60;          // 요청 사이 간격
  const START = 1;

  const url = n => '/common.do?method=getLottoNumber&drwNo=' + n;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function getDraw(n) {
    try {
      const res = await fetch(url(n), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const j = await res.json();
      if (j.returnValue !== 'success') return null;
      const nums = [j.drwtNo1, j.drwtNo2, j.drwtNo3, j.drwtNo4, j.drwtNo5, j.drwtNo6].map(Number);
      if (nums.some(v => !Number.isInteger(v) || v < 1 || v > 45)) return null;
      return [Number(j.drwNo), String(j.drwNoDate).slice(0, 10),
              ...nums.sort((a, b) => a - b), Number(j.bnusNo)];
    } catch { return null; }
  }

  // 1) 이분 탐색으로 최신 회차를 찾는다 (전체를 훑지 않아도 된다)
  console.log('[로또수집] 최신 회차 탐색 중…');
  let lo = 1, hi = 4000;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await getDraw(mid)) lo = mid; else hi = mid - 1;
    await sleep(DELAY_MS);
  }
  const latest = lo;
  if (latest < 1) { console.error('[로또수집] 실패. 대기열을 통과한 뒤 다시 시도하세요.'); return; }
  console.log('[로또수집] 최신 회차 = ' + latest + '. 1회부터 수집합니다.');

  // 2) 제한된 동시성으로 전 회차를 받는다
  const rows = [];
  const queue = [];
  for (let n = START; n <= latest; n++) queue.push(n);

  async function worker(id) {
    while (queue.length) {
      const n = queue.shift();
      const row = await getDraw(n);
      if (row) rows.push(row);
      else console.warn('[로또수집] ' + n + '회 실패');
      if (rows.length % 100 === 0) console.log('[로또수집] ' + rows.length + '/' + latest);
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  rows.sort((a, b) => a[0] - b[0]);
  console.log('[로또수집] 완료: ' + rows.length + '건 (1~' + latest + ')');

  const out = {
    schema: 'lotto-draws/1',
    source: '동행복권 dhlottery.co.kr (브라우저 직접 수집)',
    fetchedAt: new Date().toISOString(),
    note: 'numbers are stored ASCENDING; the physical ball draw order is not published.',
    fields: ['drwNo', 'date', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'bonus'],
    latest,
    count: rows.length,
    draws: rows,
  };

  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'draws.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  console.log('[로또수집] draws.json 다운로드를 시작했습니다.');
})();
