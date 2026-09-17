# 출시 점검 및 수익화 현황

점검 시각: **2026-09-17**
기준 커밋: `673f874` (실제 AdMob 광고 ID 를 담는 로컬 파일을 git 에서 제외)

이 문서는 "Play 심사를 통과하는가" 와 "실제로 돈이 들어오는가" 를 나누어 기록한다.
둘은 다른 문제다. 심사를 통과해도 결제 프로필이 없으면 수익금은 계정에 쌓이기만 한다.

---

## 1. 등록 전 점검 — 실제 확인 결과

`docs/store-listing.md` 의 '등록 전 마지막 점검' 항목을 코드·문서·네트워크로 직접 대조했다.

| 항목 | 결과 | 확인 방법 |
|---|---|---|
| 카테고리가 '도구' 인가 (게임 아님) | ✅ | `store-listing.md` 기본 정보 표. 게임 분류 시 국내 GRAC 등급분류가 별도로 필요해 의도적으로 '도구' |
| 설명에 당첨 확률 상승 암시 문구가 없는가 | ✅ | 자세한 설명에 "무작위보다 나았다는 증거는 없었다" 를 직접 명시 |
| 개인정보처리방침 URL 이 실제로 열리는가 | ✅ | `https://kcsi-solid.github.io/lotto-app/privacy.html` → **HTTP 200** |
| 데이터 안전 답변이 `privacy.html` 과 일치하는가 | ✅ | 광고 ID·대략적 위치·기기 정보·광고 상호작용 4항목이 양쪽에 동일. 결제 정보는 양쪽 모두 "앱에 전달되지 않음" |
| 스크린샷에 배너 광고가 없는가 | ✅ | 스크린샷은 웹 화면 캡처이고 배너는 네이티브에만 붙는다. UI 검사 `[10] 수익화가 웹을 침범하지 않음` 이 이를 코드로 고정 |
| 인앱 상품 ID 가 `remove_ads` 인가 | ✅ | `js/monetize.js:57` `REMOVE_ADS_PRODUCT_ID = 'remove_ads'` (앱 안의 유일한 정의) |

### 테스트

```
npm test   →  77 PASS, 0 FAIL
```

엔진 검사(`tools/selftest.mjs`)와 UI 검사(`tools/uitest.mjs`)를 모두 포함한다.
구매 상태 재조정 정책(오프라인에서 구매자의 광고 제거가 유지되는지)까지 검사 대상이다.

---

## 2. 이번에 정리한 것

- **잔재 디렉터리 삭제** — 저장소 안에 `C:Userskcseolotto-keys` 라는 빈 폴더가 남아 있었다.
  원인은 `.properties` 가 Java Properties 포맷이라 `\` 를 이스케이프 문자로 먹는 것이다.
  `storeFile=C:\Users\kcseo\lotto-keys\...` 로 적으면 `\U` `\k` `\l` 이 모두 소거되어
  `C:Userskcseolotto-keys` 라는 경로가 만들어진다.
  현재 `android/keystore.properties` 는 이미 슬래시(`/`)로 교정되어 있다.
  **윈도우 경로를 `.properties` 에 쓸 때는 `/` 또는 `\` 를 쓴다.**

- 미커밋 상태로 남은 것: `dist/BUILD.txt`, `dist/lotto-app-web.zip` (09-17 재빌드 산출물)

---

## 3. 빌드 산출물 현황

| 산출물 | 상태 |
|---|---|
| 서명된 릴리스 AAB | `android/app/build/outputs/bundle/release/app-release.aab` (09-17 10:49, 7.3 MB) |
| 업로드 키스토어 | `C:/Users/kcseo/lotto-keys/upload-keystore.jks` (별칭 `upload`) — **저장소 밖**, 분실 시 앱 업데이트 불가 |
| 웹 배포본 | `dist/web/`, `dist/lotto-app-web.zip` |
| 단일 파일 | `dist/lotto-standalone.html` |

재빌드: `npm run android:bundle`

---

## 4. 수익 구조 — 지금 코드가 하는 일

수익원은 두 갈래이며 서로 배타적이다. '광고 제거' 를 산 사용자에게는 광고 SDK 자체를 호출하지 않는다.

### 광고 (AdMob)

| 지면 | 정책 |
|---|---|
| 하단 배너 | 적응형 배너, 앱 실행 중 상시. `body` 에 `has-ad` 여백을 넣어 콘텐츠를 가리지 않는다 |
| 전면 광고 | 아래 4개 조건을 **모두** 통과할 때만 |

전면 광고 조건 (`js/monetize.js` 의 `shouldShowInterstitial`):

| 상수 | 값 | 뜻 |
|---|---|---|
| `FIRST_AD_AFTER_GENERATES` | 3 | 처음 두 번의 번호 생성은 광고 없이 보낸다 |
| `MIN_SESSION_AGE_MS` | 45,000 | 앱을 켠 뒤 45초가 지나야 후보가 된다 |
| `COOLDOWN_MS` | 180,000 | 전면 광고끼리 최소 3분 간격 |
| `MAX_PER_SESSION` | 2 | 한 세션 최대 2회 |

이 네 숫자가 **수익과 이탈률을 동시에 결정하는 유일한 다이얼**이다.
AdMob 정책은 "예기치 않은 시점의 과도한 전면 광고" 를 위반으로 보므로 공격적으로 올리면
수익이 아니라 계정 정지로 돌아올 수 있다. 출시 후 실제 지표를 보고 조정한다.

### 인앱 결제 (`remove_ads`, 비소모성)

- 구매 버튼에 Play 에서 받아온 실제 현지 가격을 표시한다 (`getProduct` → `priceString`)
- 구매 성공 시 즉시 광고 제거, 이미 산 사람에게는 구매 버튼을 숨긴다
- '구매 복원' 버튼으로 기기 이전·재설치 대응
- **오프라인 정책**: Play 조회에 실패하면 로컬 캐시를 따른다. 즉 구매자가 비행기 모드여도
  광고가 되살아나지 않는다 (`reconcileAdFree`)

---

## 5. 돈이 들어오기까지 남은 일

코드는 준비됐다. 남은 것은 대부분 Play Console / AdMob 콘솔에서의 수작업이다.

### A. 비공개 테스트 단계 (지금)

- [ ] Play Console 비공개 테스트 트랙에 `app-release.aab` 업로드
- [ ] 데이터 안전 양식 작성 (`store-listing.md` 표 그대로 옮긴다)
- [ ] 콘텐츠 등급 IARC 설문 (`store-listing.md` 표 그대로)
- [ ] 인앱 상품 등록: 상품 ID **`remove_ads`**, 비소모성, 가격 설정
      → 상품 ID 를 다르게 적으면 구매가 영영 실패한다. 코드와 철자가 같아야 한다.
- [ ] 테스터 계정 등록 후 결제 테스트 (라이선스 테스터로 넣으면 실제 청구 없이 구매 흐름 확인)

> **이 단계에서는 AdMob 을 반드시 테스트 ID 로 둔다.**
> 현재 `strings.xml` 은 구글 공식 테스트 앱 ID(`...3940256099942544~3347511713`),
> `monetize.js` 는 `LIVE_AD_UNITS` 가 비어 있어 `isTesting: true` 로 동작한다.
> 실제 광고가 뜬 상태에서 본인이나 테스터가 클릭하면 **AdMob 계정이 영구 정지**된다.

### B. 프로덕션 출시 직전

- [ ] `js/monetize.js` 의 `LIVE_AD_UNITS` 채우기 → `USE_LIVE` 가 자동으로 켜지며
      `isTesting` 과 `initializeForTesting` 이 함께 꺼진다 (스위치가 한 곳뿐이다)
- [ ] `android/app/src/main/res/values/strings.xml` 의 `admob_app_id` 를 실제 앱 ID 로
- [ ] 실제 값은 `admob.local.md` 에 있으며 이 파일은 git 에서 제외되어 있다
      (공개 저장소에 광고 단위 ID 가 노출되면 제3자가 부정 트래픽을 만들어 계정을 날릴 수 있다)
- [ ] `versionCode` 올리고 재빌드 → 프로덕션 트랙 업로드

### C. 실제 지급을 받기 위한 설정 (이것을 해야 돈이 입금된다)

- [ ] **AdMob**: 결제 프로필 생성 (이름·주소를 신분증과 동일하게)
- [ ] **AdMob**: 세금 정보 W-8BEN 제출 + 한미 조세조약 혜택 신청 (안 하면 30% 원천징수)
- [ ] **AdMob**: 한국 은행 계좌 등록 (SWIFT 코드 필요)
- [ ] **AdMob**: 주소 확인 PIN 우편 수령 후 입력 (잔액 $10 도달 시 발송, 2~4주 소요)
- [ ] **AdMob**: Play 게시 후 '앱스토어에 연결' 로 앱 연결
- [ ] **Play Console**: 판매자 계정 결제 프로필 + 세금 정보 (인앱 결제 수익용, AdMob 과 별개)

> AdMob 지급 기준액은 보통 $100 이다. 주소 확인 PIN 은 잔액 $10 부터 발송되므로
> **미리 신청해 두지 않으면 기준액을 넘긴 뒤 4주를 더 기다리게 된다.**

---

## 6. 다음에 손댈 만한 것

- 출시 후 AdMob 지표(노출·클릭률·이탈)를 보고 4개 전면 광고 상수를 조정
- '광고 제거' 가격 실험 (Play Console 에서 코드 변경 없이 가능)
- 리워드 광고 도입 검토 — "광고 한 편 보고 하루 광고 제거" 같은 형태.
  전면 광고보다 단가가 높고 사용자가 스스로 선택하므로 이탈 위험이 낮다
