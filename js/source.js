/**
 * source.js — 당첨번호 데이터의 획득/갱신.
 *
 * 왜 이런 구조인가
 *  동행복권(dhlottery.co.kr)의 공개 JSON 엔드포인트는 현재 봇 차단(NetFUNNEL 대기열)이
 *  걸려 있어 브라우저 밖에서는 물론, 다른 출처(origin)의 웹페이지에서도 CORS 때문에
 *  직접 읽을 수 없다. 그래서 데이터 획득 경로를 세 갈래로 분리했다.
 *
 *   1) 번들 데이터  data/draws.json — 앱에 동봉. 오프라인에서도 즉시 동작한다.
 *   2) 원격 갱신    설정한 엔드포인트에서 최신 회차만 증분으로 받아온다.
 *   3) 수동 가져오기 사용자가 파일이나 붙여넣기로 직접 넣는다. (최후의 수단)
 */
import { saveCachedDraws, loadCachedDraws } from './store.js';

export const SCHEMA = 'lotto-draws/1';

/** 서로 다른 응답 모양을 [drwNo, date, n1..n6, bonus] 한 줄로 정규화한다. */
export function normalizeRow(o) {
  if (Array.isArray(o) && o.length >= 9) return o.slice(0, 9);
  if (!o || typeof o !== 'object') return null;

  const no = o.drwNo ?? o.draw_no ?? o.drawNo ?? o.round ?? o.no;
  let nums = o.numbers ?? o.nums;
  if (!Array.isArray(nums)) {
    nums = [o.drwtNo1, o.drwtNo2, o.drwtNo3, o.drwtNo4, o.drwtNo5, o.drwtNo6];
  }
  const bonus = o.bnusNo ?? o.bonus_no ?? o.bonusNo ?? o.bonus;
  const date = String(o.drwNoDate ?? o.date ?? '').slice(0, 10);

  if (!Number.isInteger(no)) return null;
  if (!Array.isArray(nums) || nums.length !== 6) return null;
  const clean = nums.map(Number);
  if (clean.some(n => !Number.isInteger(n) || n < 1 || n > 45)) return null;
  if (new Set(clean).size !== 6) return null;
  const b = Number(bonus);
  if (!Number.isInteger(b) || b < 1 || b > 45) return null;

  return [no, date, ...clean.sort((a, x) => a - x), b];
}

/** 회차 배열을 검증하고 정렬·중복 제거한 데이터베이스 객체로 만든다. */
export function buildDb(rows, meta = {}) {
  const seen = new Map();
  for (const r of rows) {
    const row = normalizeRow(r);
    if (row) seen.set(row[0], row);
  }
  const draws = [...seen.values()].sort((a, b) => a[0] - b[0]);
  if (!draws.length) throw new Error('유효한 회차가 하나도 없습니다.');
  return {
    schema: SCHEMA,
    source: meta.source || '알 수 없음',
    fetchedAt: meta.fetchedAt || new Date().toISOString(),
    fields: ['drwNo', 'date', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'bonus'],
    latest: draws[draws.length - 1][0],
    count: draws.length,
    draws,
  };
}

/** 번들 데이터와 로컬 캐시 중 더 최신인 쪽을 고른다. */
export async function loadDraws() {
  const res = await fetch('data/draws.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('번들 데이터를 읽지 못했습니다 (HTTP ' + res.status + ')');
  const bundled = await res.json();
  const cached = loadCachedDraws();
  if (cached && cached.schema === SCHEMA && cached.latest > bundled.latest) {
    return { ...cached, origin: 'cache' };
  }
  return { ...bundled, origin: 'bundle' };
}

/**
 * 엔드포인트에서 최신 회차를 증분으로 받아온다.
 * API 키는 URL이 아닌 HTTP 헤더로만 보낸다 — URL에 넣으면 기록·로그에 남는다.
 */
export async function updateFromEndpoint(db, opts = {}) {
  const { endpoint, apiKey, authHeader, authScheme, maxFetch = 40, onProgress } = opts;
  if (!endpoint || !endpoint.includes('{draw}')) {
    throw new Error('엔드포인트에 회차 자리표시자 {draw} 가 필요합니다.');
  }
  const headers = { Accept: 'application/json' };
  if (apiKey) {
    headers[authHeader || 'Authorization'] = (authScheme ? authScheme + ' ' : '') + apiKey;
  }

  const added = [];
  let next = db.latest + 1;
  let misses = 0;
  for (let i = 0; i < maxFetch && misses < 2; i++, next++) {
    if (onProgress) onProgress(next, added.length);
    let row = null;
    try {
      const r = await fetch(endpoint.replace('{draw}', String(next)), {
        headers, cache: 'no-cache', referrerPolicy: 'no-referrer',
      });
      if (r.status === 401 || r.status === 403) {
        throw new Error('인증 실패 (HTTP ' + r.status + '). API 키를 확인하세요.');
      }
      if (r.ok) row = normalizeRow(await r.json());
    } catch (e) {
      if (String(e.message).includes('인증 실패')) throw e;
      row = null;   // 네트워크/CORS 오류는 "아직 없는 회차"와 같게 취급한다
    }
    if (row) { added.push(row); misses = 0; }
    else { misses++; }
  }

  if (!added.length) return { db, added: 0 };
  const merged = buildDb([...db.draws, ...added], { source: db.source, fetchedAt: new Date().toISOString() });
  saveCachedDraws(merged);
  return { db: { ...merged, origin: 'cache' }, added: added.length };
}

/** 사용자가 붙여넣거나 파일로 준 JSON을 데이터베이스로 만든다. */
export function importJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('JSON 형식이 아닙니다.'); }

  const rows = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed.draws) ? parsed.draws
    : Array.isArray(parsed.results) ? parsed.results
    : null;
  if (!rows) throw new Error('회차 배열을 찾지 못했습니다. 배열이거나 {draws:[...]} 형태여야 합니다.');

  const db = buildDb(rows, { source: parsed.source || '직접 가져오기' });
  saveCachedDraws(db);
  return { ...db, origin: 'cache' };
}
