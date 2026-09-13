# 안드로이드 앱 빌드 (Capacitor)

이 앱은 **Capacitor 로 감싼 네이티브 안드로이드 앱**으로 구글 플레이에 올립니다.
TWA(웹주소 래핑)를 쓰지 않는 이유는 하나입니다 — **TWA 안에서는 AdMob 광고를 띄울 수 없습니다.**
Chrome 이 화면 전체를 그려 네이티브 AdView 를 겹칠 수 없고, PWA 안에 AdSense 를 넣는 것은
'앱 내 AdSense 금지' 정책 위반입니다.

Capacitor 프로젝트는 저장소 루트의 `android/` 에 있습니다. 이 폴더는 참고 문서만 담습니다.

---

## 사전 준비 (한 번만)

```powershell
winget install --id EclipseAdoptium.Temurin.21.JDK
winget install --id Google.AndroidStudio
```

## 빌드

```bash
npm run build          # dist/web/ 생성 — Capacitor 의 webDir 이다
npx cap sync android   # 웹 자산 + 네이티브 플러그인 동기화
npx cap run android    # 에뮬레이터/실기기에서 실행

cd android && ./gradlew bundleRelease
# -> android/app/build/outputs/bundle/release/app-release.aab  (Play 제출용)
```

> `npm run build` 를 먼저 돌리지 않으면 `cap sync` 가 **예전 dist/web 을 그대로 복사합니다.**
> 화면이 안 바뀌면 거의 항상 이것이 원인입니다.

## 출시 전 점검

1. `js/monetize.js` 의 `LIVE_AD_UNITS` 를 실제 AdMob 광고 단위 ID 로 채웠는가
   (비어 있으면 테스트 광고가 나갑니다 — 수익 0)
2. `android/app/src/main/res/values/strings.xml` 의 `admob_app_id` 가 실제 앱 ID 인가
3. 업로드 키스토어를 **백업**했는가 (잃으면 앱 업데이트가 영구 불가)
4. 개인정보처리방침 URL 이 살아 있고, Play 데이터 안전 양식과 내용이 일치하는가

## 아이폰

iOS 는 Mac + Xcode + 개발자 계정(연 $99)이 필요합니다.
**사파리에서 `공유 → 홈 화면에 추가`** 로 PWA 를 설치하는 것이 현실적인 대안입니다.
배포 주소: https://<아이디>.github.io/lotto-app/
