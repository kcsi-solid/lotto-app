/**
 * store.js — 설정과 API 키의 로컬 보관.
 *
 * 개인정보 원칙 (이 파일이 지키는 약속)
 *  1. API 키는 이 기기의 브라우저 localStorage에만 저장한다. 서버로 보내지 않는다.
 *  2. 키는 사용자가 직접 지정한 엔드포인트로만, 그것도 URL이 아닌 HTTP 헤더로 전송한다.
 *     (URL 쿼리에 넣으면 브라우저 기록·프록시 로그·Referer 헤더에 그대로 남는다.)
 *  3. 키는 콘솔에 출력하지 않고, 결과 내보내기(공유)에도 절대 포함하지 않는다.
 *  4. 화면에는 항상 마스킹해 보여주고, 원문은 '보기'를 눌렀을 때만 드러낸다.
 */
const KEY_SETTINGS = 'lotto.settings.v1';
const KEY_APIKEY = 'lotto.apikey.v1';
const KEY_DRAWS = 'lotto.draws.v1';
const KEY_ADFREE = 'lotto.adfree.v1';

export const DEFAULT_SETTINGS = {
  games: 5,
  halfLife: 260,
  temperature: 0.6,
  useFilters: true,
  showProb: true,
  weights: { freq: 0.30, markov: 0.30, gap: 0.25, position: 0.15 },
  endpoint: 'https://smok95.github.io/lotto/results/{draw}.json',
  authHeader: 'Authorization',
  authScheme: 'Bearer',
  seed: '',
};

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** localStorage를 쓸 수 없는 환경(시크릿 모드, 저장소 차단)에서도 앱이 죽지 않게 한다. */
function ls() {
  try {
    const s = window.localStorage;
    s.getItem(KEY_SETTINGS);
    return s;
  } catch { return null; }
}

export function loadSettings() {
  const s = ls();
  const saved = s ? safeParse(s.getItem(KEY_SETTINGS), {}) : {};
  return { ...DEFAULT_SETTINGS, ...saved, weights: { ...DEFAULT_SETTINGS.weights, ...(saved.weights || {}) } };
}

export function saveSettings(settings) {
  const s = ls();
  if (!s) return false;
  const { apiKey, ...clean } = settings;   // 키는 설정과 분리해 저장한다
  try { s.setItem(KEY_SETTINGS, JSON.stringify(clean)); return true; } catch { return false; }
}

export function loadApiKey() {
  const s = ls();
  if (!s) return '';
  try { return s.getItem(KEY_APIKEY) || ''; } catch { return ''; }
}

export function saveApiKey(key) {
  const s = ls();
  if (!s) return false;
  try {
    if (key) s.setItem(KEY_APIKEY, key);
    else s.removeItem(KEY_APIKEY);
    return true;
  } catch { return false; }
}

export function clearApiKey() { return saveApiKey(''); }

/** 화면 표시용 마스킹: 앞 2자 + 별표 + 뒤 2자. 짧은 키는 통째로 가린다. */
export function maskKey(key) {
  if (!key) return '(저장된 키 없음)';
  if (key.length <= 8) return '•'.repeat(key.length);
  return key.slice(0, 2) + '•'.repeat(Math.min(20, key.length - 4)) + key.slice(-2);
}

export function loadCachedDraws() {
  const s = ls();
  if (!s) return null;
  return safeParse(s.getItem(KEY_DRAWS), null);
}

export function saveCachedDraws(db) {
  const s = ls();
  if (!s) return false;
  try { s.setItem(KEY_DRAWS, JSON.stringify(db)); return true; }
  catch { return false; }   // 용량 초과 시 조용히 포기하고 번들 데이터를 계속 쓴다
}

export function clearCachedDraws() {
  const s = ls();
  if (!s) return false;
  try { s.removeItem(KEY_DRAWS); return true; } catch { return false; }
}

/* ---------------------------------------------------------------- 광고 제거 구매
 *
 * 이 값은 **캐시일 뿐 권한의 근거가 아니다.**
 * localStorage는 사용자가 개발자도구로 얼마든지 고칠 수 있으므로
 * 진실의 근원은 언제나 Google Play 의 구매 기록이다.
 *
 * 그래도 캐시를 두는 이유는 두 가지다.
 *  1. 앱을 켜자마자 배너를 띄웠다가 Play 조회 후 지우면 화면이 깜빡인다.
 *     캐시가 참이면 처음부터 띄우지 않는다.
 *  2. 비행기 모드에서는 Play 조회가 실패한다. 돈을 낸 사용자에게
 *     오프라인이라는 이유로 광고를 보여주는 것은 부당하다.
 *
 * 반대 방향(캐시가 거짓인데 실제로는 구매함)은 앱 시작 시 restorePurchases()가 바로잡는다.
 */
export function loadAdFree() {
  const s = ls();
  if (!s) return false;
  try { return s.getItem(KEY_ADFREE) === '1'; } catch { return false; }
}

export function saveAdFree(on) {
  const s = ls();
  if (!s) return false;
  try {
    if (on) s.setItem(KEY_ADFREE, '1');
    else s.removeItem(KEY_ADFREE);
    return true;
  } catch { return false; }
}
