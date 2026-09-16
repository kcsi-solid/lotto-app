/**
 * monetize.js — AdMob 광고와 '광고 제거' 구매.
 *
 * ## 이 파일이 지키는 네 가지 제약
 *
 * 1. **네이티브에서만 불린다.** app.js 가 `window.Capacitor?.isNativePlatform?.()` 일 때만
 *    동적 import 한다. 웹(GitHub Pages)과 단일 파일(lotto-standalone.html)은 이 코드를
 *    아예 읽지 않는다. tools/build.mjs 의 단일파일 모듈 목록(4개)을 건드리지 않는 이유가 이것이다.
 *
 * 2. **번들러를 들이지 않는다.** 이 프로젝트는 빌드 도구 없는 순수 ES 모듈이라
 *    `import { AdMob } from '@capacitor-community/admob'` 같은 bare specifier 를
 *    브라우저가 해석하지 못한다. 그래서 플러그인 JS 를 거치지 않고
 *    **Capacitor 네이티브 브릿지를 직접 호출**한다.
 *
 *      플러그인의 AdMob.showBanner(o)  ==  Capacitor.nativePromise('AdMob', 'showBanner', o)
 *
 *    플러그인 프록시가 하는 일이 정확히 이 한 줄이다(@capacitor/core 의 registerPlugin 참고).
 *    npm 패키지는 여전히 필요하다 — `npx cap sync` 가 그걸 보고 안드로이드 네이티브
 *    라이브러리를 프로젝트에 넣기 때문이다. JS 쪽만 건너뛰는 것이다.
 *
 * 3. **광고 실패가 앱을 막지 않는다.** 이 앱의 핵심 가치는 오프라인 동작이다.
 *    비행기 모드에서 광고는 반드시 실패하는데, 그때도 번호 생성은 멀쩡해야 한다.
 *    그래서 모든 광고 호출을 삼키고 절대 위로 던지지 않는다.
 *
 * 4. **광고가 콘텐츠를 가리지 않는다.** 배너가 실제로 떴을 때만 body 에 has-ad 를 붙여
 *    하단 여백을 확보한다. 배너가 안 뜨면 여백도 없다.
 *
 * ## 광고 ID 주의
 *
 * 개발·테스트 내내 구글 공식 **테스트 광고 ID** 만 쓴다.
 * 실제 광고 단위로 자기 앱을 띄우거나 클릭하면 AdMob 계정이 영구 정지된다.
 * 프로덕션 출시 직전에 LIVE_AD_UNITS 를 채운다.
 */

import { loadAdFree, saveAdFree } from './store.js';

/** 구글 공식 테스트 광고 단위. 누가 봐도 테스트임을 알 수 있게 상수로 분리해 둔다. */
const TEST_AD_UNITS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
};

/** 실제 광고 단위 — AdMob 콘솔에서 발급받아 채운다. 비어 있으면 테스트 ID 를 쓴다. */
const LIVE_AD_UNITS = {
  banner: '',
  interstitial: '',
};

const USE_LIVE = Boolean(LIVE_AD_UNITS.banner);
const AD_UNITS = USE_LIVE ? LIVE_AD_UNITS : TEST_AD_UNITS;

/** 플러그인 enum 의 값. 문자열 그대로다 (banner-ad-size.enum.js / banner-ad-position.enum.js). */
const ADAPTIVE_BANNER = 'ADAPTIVE_BANNER';
const BOTTOM_CENTER = 'BOTTOM_CENTER';

/** Play Console → 수익 창출 → 인앱 상품에 등록할 상품 ID (비소모성). */
export const REMOVE_ADS_PRODUCT_ID = 'remove_ads';

let bannerVisible = false;
let interstitialReady = false;
let adFree = loadAdFree();

/** 전면 광고 정책 판단에 쓰는 세션 상태. shouldShowInterstitial() 이 읽는다. */
const session = {
  startedAt: Date.now(),
  generateCount: 0,        // 이번 세션에서 '번호 생성'을 누른 횟수
  interstitialShownAt: 0,  // 마지막으로 전면 광고를 띄운 시각 (0 = 아직 없음)
  interstitialCount: 0,    // 이번 세션에서 띄운 전면 광고 수
};

/* ---------------------------------------------------------------- 브릿지 */

/** 네이티브 AdMob 플러그인이 실제로 붙어 있는가. cap sync 를 빠뜨렸으면 false. */
function hasNativeAdMob() {
  const cap = window.Capacitor;
  return Boolean(cap?.nativePromise && cap.PluginHeaders?.some(h => h.name === 'AdMob'));
}

/**
 * 네이티브 AdMob 메서드를 부른다.
 * 광고는 없어도 되는 기능이므로 실패를 삼키고 성공 여부만 돌려준다.
 */
async function callAdMob(method, options) {
  try {
    await window.Capacitor.nativePromise('AdMob', method, options);
    return true;
  } catch (e) {
    console.warn('[ads] ' + method + ' 실패 — 무시하고 계속합니다:', e?.message || e);
    return false;
  }
}

function setBodyAdPadding(on) {
  document.body.classList.toggle('has-ad', on);
}

/* ---------------------------------------------------------------- 배너 */

async function showBanner() {
  if (adFree || bannerVisible) return;
  const ok = await callAdMob('showBanner', {
    adId: AD_UNITS.banner,
    adSize: ADAPTIVE_BANNER,
    position: BOTTOM_CENTER,
    margin: 0,
    isTesting: !USE_LIVE,
  });
  bannerVisible = ok;
  setBodyAdPadding(ok);
}

async function hideBanner() {
  if (!bannerVisible) return;
  await callAdMob('removeBanner', {});
  bannerVisible = false;
  setBodyAdPadding(false);
}

/* ---------------------------------------------------------------- 전면 광고 */

async function prepareInterstitial() {
  if (adFree) return;
  interstitialReady = await callAdMob('prepareInterstitial', {
    adId: AD_UNITS.interstitial,
    isTesting: !USE_LIVE,
  });
}

/* 전면 광고 정책 상수. 숫자를 바꾸고 싶으면 여기만 고치면 된다. */

/** 이 횟수만큼 생성할 때까지는 광고를 띄우지 않는다. 첫인상을 광고로 만들지 않기 위함. */
const FIRST_AD_AFTER_GENERATES = 3;
/** 앱을 켠 뒤 이 시간이 지나야 후보가 된다. 열자마자 연타하는 경우를 막는다. */
const MIN_SESSION_AGE_MS = 45_000;
/** 전면 광고끼리의 최소 간격. */
const COOLDOWN_MS = 180_000;
/** 한 세션에서 띄울 수 있는 최대 횟수. */
const MAX_PER_SESSION = 2;

/**
 * 전면 광고를 지금 띄울지 결정한다.
 *
 * 이 함수 하나가 수익과 사용자 경험, 그리고 정책 위반 위험을 동시에 결정한다.
 * AdMob 정책은 "예기치 않은 시점의 과도한 전면 광고"를 위반으로 본다.
 *
 * 세 개의 축을 전부 건다.
 *
 *  1. **유예** — 처음 두 번의 생성은 그냥 보내준다. 이 앱은 한 번 켜서 몇 게임 뽑고
 *     닫는 짧은 세션이 대부분이라, 첫 화면부터 광고를 맞으면 그대로 삭제로 이어진다.
 *     3회째부터 후보가 되므로 "한 번 써보고 마음에 들어 더 뽑는 사람"만 광고를 본다.
 *  2. **쿨다운** — 한 번 띄우면 3분간 다시 띄우지 않는다. 연속 생성이 이 앱의 자연스러운
 *     사용 방식(가중치를 바꿔가며 여러 번 뽑는다)이라, 횟수만으로 제한하면 그 흐름을 끊는다.
 *  3. **세션 상한** — 아무리 오래 써도 한 세션에 2회까지다. 오래 쓰는 사람은
 *     이 앱을 좋아하는 사람이고, 그 사람을 광고로 쫓아내는 것은 손해다.
 *
 * 시작 직후 45초 유예를 따로 두는 이유는, 열자마자 생성을 세 번 연타하면 1번 조건만으로는
 * 10초 만에 광고가 뜨기 때문이다. 그건 사용자 입장에서 "예기치 않은" 광고다.
 *
 * @param {{startedAt:number, generateCount:number, interstitialShownAt:number, interstitialCount:number}} s
 *        session 객체. 시각은 전부 Date.now() 기준 밀리초.
 *        이 함수가 불리는 시점에 generateCount 는 방금 누른 것까지 세어져 있다.
 * @param {number} [now] 현재 시각. 검사에서 시간을 주입하려고 열어 둔 인자다.
 * @returns {boolean} 띄우려면 true
 */
export function shouldShowInterstitial(s, now = Date.now()) {
  if (s.interstitialCount >= MAX_PER_SESSION) return false;
  if (s.generateCount < FIRST_AD_AFTER_GENERATES) return false;
  if (now - s.startedAt < MIN_SESSION_AGE_MS) return false;
  // interstitialShownAt 이 0 이면 아직 한 번도 안 띄운 것이라 쿨다운을 따지지 않는다.
  if (s.interstitialShownAt && now - s.interstitialShownAt < COOLDOWN_MS) return false;
  return true;
}

/** '번호 생성'이 끝난 뒤 app.js 가 부른다. 정책이 허락할 때만 전면 광고를 띄운다. */
export async function onGenerated() {
  if (adFree) return;
  session.generateCount++;
  if (!interstitialReady) return;
  if (!shouldShowInterstitial(session)) return;

  const shown = await callAdMob('showInterstitial', {});
  if (shown) {
    session.interstitialShownAt = Date.now();
    session.interstitialCount++;
  }
  interstitialReady = false;
  prepareInterstitial();   // 다음 기회를 위해 미리 받아둔다 (await 하지 않는다)
}

/* ---------------------------------------------------------------- 광고 제거 구매 */

/**
 * 결제 플러그인의 등록명.
 * node_modules/@capgo/native-purchases/dist/esm/index.js:2 의 registerPlugin('NativePurchases') 에서 확인했다.
 * AdMob 과 같은 이유로 여기서도 플러그인 JS 를 거치지 않고 브릿지를 직접 부른다.
 */
const BILLING = 'NativePurchases';

/** Play 상품 유형. 광고 제거는 구독이 아니라 일회성 구매다. */
const INAPP = 'inapp';

/** Play 조회가 연속으로 실패한 횟수. 성공하면 0 으로 돌아간다. reconcileAdFree() 가 읽는다. */
let billingFailureStreak = 0;

/** 네이티브 결제 플러그인이 실제로 붙어 있는가. 웹에서는 항상 false. */
function hasBilling() {
  const cap = window.Capacitor;
  return Boolean(cap?.nativePromise && cap.PluginHeaders?.some(h => h.name === BILLING));
}

/**
 * 네이티브 결제 메서드를 부른다.
 *
 * 광고(callAdMob)는 실패를 통째로 삼켜도 됐지만 **결제는 다르다.**
 * 돈을 내려던 사용자가 아무 반응 없는 버튼을 보게 두면 안 되므로,
 * 예외를 앱 밖으로 던지지는 않되 실패 사유는 반드시 위로 돌려준다.
 */
async function callBilling(method, options) {
  try {
    return { ok: true, value: await window.Capacitor.nativePromise(BILLING, method, options) };
  } catch (e) {
    const error = e?.message || String(e);
    console.warn('[billing] ' + method + ' 실패:', error);
    return { ok: false, error };
  }
}

/** 현재 광고 제거 상태. */
export function isAdFree() {
  return adFree;
}

/**
 * 구매 상태를 적용한다.
 * 진실의 근원은 Google Play 이며, 여기서 받은 값을 localStorage 에 캐시한다.
 */
export async function applyAdFree(on) {
  adFree = Boolean(on);
  saveAdFree(adFree);
  if (adFree) await hideBanner();
  else await showBanner();
}

/* ------------------------------------------------------- 구매 상태 재조정 (정책) */

/**
 * Play 조회 결과와 기기 캐시(localStorage)를 맞춰 **최종 광고 제거 상태**를 정한다.
 *
 * store.js 는 "진실의 근원은 Play, 캐시는 깜빡임과 오프라인 대비" 라고 선언해 뒀지만,
 * 그 선언이 답하지 않는 경우가 셋 남아 있다.
 *
 *  - 조회가 아예 실패했는데(비행기 모드·Play 서비스 없음) 캐시는 '구매함' 이다.
 *    돈을 낸 사람에게 오프라인이라는 이유로 광고를 보여줄 것인가.
 *  - 조회는 성공했는데 구매가 없고 캐시는 '구매함' 이다.
 *    환불일 수도, 계정을 바꿔 로그인한 것일 수도 있다. 광고를 즉시 되살릴 것인가.
 *  - 실패가 여러 번 이어지면 그때는 캐시를 의심할 것인가.
 *
 * 순수 함수로 떼어 둔 이유는 shouldShowInterstitial(s, now) 과 같다 —
 * 네트워크도 시각도 없이 검사에서 모든 분기를 돌려볼 수 있다.
 *
 * ## 정한 규칙과 근거
 *
 * 1. **조회가 성공하면 Play 를 따른다** — 'owned' 면 참, 'none' 이면 거짓.
 *    캐시가 참인데 'none' 이 나오는 경우(환불·구매 취소·다른 계정으로 로그인)에도
 *    거짓으로 되돌린다. Play 는 이 기기에 **지금 로그인한 계정**을 기준으로 답하므로,
 *    계정을 되돌리거나 '구매 복원' 을 누르면 즉시 참으로 돌아온다.
 *    조작 가능한 캐시보다 조회 성공값이 언제나 낫다.
 *
 * 2. **조회가 실패하면 캐시를 그대로 믿는다** — failureStreak 와 무관하게.
 *    이 규칙이 failureStreak 를 의도적으로 쓰지 않는 이유가 여기 있다.
 *    완전 오프라인 동작이 이 앱의 핵심 가치라, 결제 조회 실패가 **수백 번 이어지는 것이
 *    정상 사용**이다. 실패 횟수로 캐시를 버리면 가장 오래 오프라인으로 쓴 사용자,
 *    즉 이 앱을 가장 아끼는 사용자가 정확히 가장 크게 손해를 본다.
 *    손익도 비대칭이다 — 캐시를 조작한 사람에게 잃는 것은 광고 노출 몇 건이지만,
 *    돈을 낸 사용자에게 광고를 띄워 잃는 것은 환불 요구와 별점이다.
 *    어차피 캐시를 고칠 수 있는 사람은 APK 도 뜯을 수 있다.
 *
 * failureStreak 는 그래서 판단에 쓰지 않고, 호출부의 진단(로그·문구)용으로만 남겨 둔다.
 *
 * @param {boolean} cached 기기에 저장된 값 (store.js 의 loadAdFree())
 * @param {{status:'owned'|'none'|'unavailable', failureStreak:number}} playResult
 *        status — 'owned': Play 가 구매를 확인함 / 'none': 조회 성공, 구매 없음 /
 *                 'unavailable': 조회 자체가 실패함
 *        failureStreak — 연속 실패 횟수. 조회에 성공하면 0. (판단에는 쓰지 않는다)
 * @returns {boolean} 광고를 제거한 상태로 둘 것인가
 */
export function reconcileAdFree(cached, playResult) {
  switch (playResult?.status) {
    case 'owned': return true;
    case 'none': return false;
    // 'unavailable' 과 알 수 없는 값은 모두 "판단할 근거가 없음" 이다.
    // 근거가 없을 때 사용자에게 불리한 쪽으로 기울지 않는다.
    default: return Boolean(cached);
  }
}

/* ---------------------------------------------------------------- 구매 · 복원 */

/** Play 에 '광고 제거'를 실제로 보유했는지 묻는다. 실패도 상태값으로 돌려준다. */
async function queryPlay() {
  const res = await callBilling('getPurchases', { productType: INAPP });
  if (!res.ok) {
    billingFailureStreak++;
    return { status: 'unavailable', failureStreak: billingFailureStreak, error: res.error };
  }
  billingFailureStreak = 0;
  const purchases = res.value?.purchases || [];
  const owned = purchases.some(p => p?.productIdentifier === REMOVE_ADS_PRODUCT_ID);
  return { status: owned ? 'owned' : 'none', failureStreak: 0 };
}

/** Play 를 조회해 광고 제거 상태를 바로잡는다. 앱 시작 시와 '구매 복원' 에서 쓴다. */
export async function refreshAdFree() {
  const before = isAdFree();
  const result = await queryPlay();
  const after = reconcileAdFree(before, result);
  await applyAdFree(after);

  // 광고가 되살아났다면 이유를 남긴다. 아무 설명 없이 광고가 돌아오면
  // 사용자는 앱이 돈을 먹었다고 여긴다 (reconcileAdFree 규칙 1 참고).
  if (before && !after) {
    setAdFreeStatus('현재 Google 계정에서 구매 내역을 찾지 못해 광고가 다시 표시됩니다. '
      + '구매하신 계정으로 로그인한 뒤 ‘구매 복원’ 을 눌러 주세요.');
  }

  renderAdFreeUi();
  return result;
}

function setAdFreeStatus(text) {
  const el = document.getElementById('adFreeStatus');
  if (el) el.textContent = text;
}

/** 진행 중에는 두 버튼을 모두 잠근다. 결제창이 두 번 뜨는 사고를 막는다. */
function setAdFreeBusy(on) {
  for (const id of ['buyAdFree', 'restorePurchase']) {
    const b = document.getElementById(id);
    if (b) b.disabled = on;
  }
}

/** 이미 산 사람에게 구매 버튼을 보여주지 않는다. 복원 버튼은 기기 이전을 위해 남긴다. */
function renderAdFreeUi() {
  const buy = document.getElementById('buyAdFree');
  if (buy) buy.hidden = adFree;
}

/** '광고 제거 구매' 버튼. */
export async function buyAdFree() {
  setAdFreeBusy(true);
  setAdFreeStatus('Google Play 결제창을 여는 중입니다…');

  // 비소모성 상품이므로 자동 승인(기본값)을 그대로 쓴다.
  // Android 는 3일 안에 승인하지 않으면 Play 가 결제를 자동 환불한다.
  const res = await callBilling('purchaseProduct', {
    productIdentifier: REMOVE_ADS_PRODUCT_ID,
    productType: INAPP,
  });

  if (res.ok) {
    await applyAdFree(true);
    setAdFreeStatus('구매가 완료되었습니다. 광고가 사라졌습니다.');
  } else {
    // 사용자가 결제창을 닫은 경우도 여기로 온다. 실패와 취소를 문구로 구분하지 않는다.
    setAdFreeStatus('구매를 완료하지 못했습니다. 이미 구매하셨다면 아래 ‘구매 복원’ 을 눌러 주세요.');
  }

  renderAdFreeUi();
  setAdFreeBusy(false);
  return res.ok;
}

/** '구매 복원' 버튼. 기기를 바꾸거나 앱을 지웠다 깐 경우를 위한 것이다. */
export async function restoreAdFree() {
  setAdFreeBusy(true);
  setAdFreeStatus('구매 내역을 확인하는 중입니다…');

  const r = await refreshAdFree();
  if (r.status === 'owned') setAdFreeStatus('구매가 확인되었습니다. 광고가 사라졌습니다.');
  else if (r.status === 'none') setAdFreeStatus('이 Google 계정에서 구매 내역을 찾지 못했습니다.');
  else setAdFreeStatus('Google Play 에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.');

  setAdFreeBusy(false);
  return r.status;
}

/**
 * 결제를 켠다. 플러그인이 없거나 기기가 결제를 지원하지 않으면
 * #adFreeCard 는 hidden 인 채로 남는다 — 웹과 단일 파일에서 카드가 보이지 않는 이유다.
 */
async function initPurchases() {
  if (!hasBilling()) return;

  const sup = await callBilling('isBillingSupported', {});
  if (!sup.ok || !sup.value?.isBillingSupported) return;

  const card = document.getElementById('adFreeCard');
  if (card) card.hidden = false;

  document.getElementById('buyAdFree')?.addEventListener('click', buyAdFree);
  document.getElementById('restorePurchase')?.addEventListener('click', restoreAdFree);

  // 가격은 Play 가 사용자의 통화와 지역에 맞춰 내려준다. 앱에 숫자를 하드코딩하지 않는다.
  const p = await callBilling('getProduct', {
    productIdentifier: REMOVE_ADS_PRODUCT_ID,
    productType: INAPP,
  });
  const buy = document.getElementById('buyAdFree');
  if (buy && p.ok && p.value?.product?.priceString) {
    buy.textContent = '광고 제거 ' + p.value.product.priceString;
  }

  renderAdFreeUi();
  await refreshAdFree();   // 시작 시 Play 를 진실의 근원으로 삼아 캐시를 바로잡는다
}

/* ---------------------------------------------------------------- 시작 */

/**
 * 광고를 켠다. app.js 의 main() 마지막에서 네이티브일 때만 불린다.
 * 어떤 경우에도 예외를 던지지 않는다.
 */
export async function startAds() {
  if (!hasNativeAdMob()) {
    console.warn('[ads] 네이티브 AdMob 플러그인이 없습니다. 광고 없이 계속합니다.');
  } else {
    // initializeForTesting 은 이 기기를 테스트 기기로 등록해 실 광고가 뜨는 사고를 막는다.
    // 실 광고 단위로 전환하면 자동으로 꺼진다.
    await callAdMob('initialize', { initializeForTesting: !USE_LIVE });

    if (!adFree) {             // 구매자에게는 SDK 를 더 호출하지 않는다
      await showBanner();
      prepareInterstitial();   // 첫 전면 광고를 미리 받아둔다 (await 하지 않는다)
    }
  }

  // 광고가 없더라도 결제는 켠다. AdMob 이 죽어도 구매·복원은 되어야 한다.
  await initPurchases();
}
