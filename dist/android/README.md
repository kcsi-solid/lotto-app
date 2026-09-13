# 안드로이드 APK 만들기

이 PC에는 **JDK와 Android SDK가 없어서 APK를 직접 빌드하지 못했습니다.**
(`java`, `gradle`, `ANDROID_HOME` 모두 확인했으나 없음)

APK는 웹에 올린 주소가 있어야 만들 수 있습니다. 먼저 배포부터 하세요.

---

## 방법 1 — PWABuilder (설치 불필요, 가장 쉬움)

1. 사이트를 먼저 배포합니다 (`dist/web/` 을 GitHub Pages / Netlify / Vercel 에 업로드).
2. <https://www.pwabuilder.com> 에 접속해 배포한 주소를 입력합니다.
3. **Package For Stores → Android** 를 고릅니다.
4. `Download` 를 누르면 서명된 APK 와 AAB 가 담긴 zip 을 받습니다.
   - 테스트 설치용은 `app-release-signed.apk`
   - 구글 플레이 제출용은 `.aab`

받은 zip 안의 `assetlinks.json` 을 사이트의 `/.well-known/assetlinks.json` 경로에
올려야 주소창 없이 전체화면으로 뜹니다. 올리지 않으면 상단에 주소 막대가 남습니다.

## 방법 2 — Bubblewrap (로컬 빌드)

JDK 17 과 Android SDK 를 설치한 뒤:

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest <배포주소>/manifest.webmanifest
bubblewrap build
```

같은 폴더의 `twa-manifest.json` 을 참고용으로 넣어 뒀습니다.
`host`, `iconUrl`, `packageId` 를 실제 배포 주소와 원하는 패키지명으로 바꾸세요.

## 방법 3 — APK 없이 쓰기 (권장)

사실 APK가 꼭 필요하지 않습니다.

- **PWA 설치**: 배포 주소를 핸드폰 브라우저로 열고 `홈 화면에 추가`.
  아이콘으로 실행되고 주소창 없이 전체화면으로 뜨며, 오프라인에서도 동작합니다.
- **단일 파일**: `dist/lotto-standalone.html` 을 핸드폰에 복사해 브라우저로 엽니다.
  서버도 인터넷도 필요 없습니다.

## 아이폰

iOS 는 APK 개념이 없고, 앱스토어 배포에는 Mac + Xcode + 개발자 계정(연 $99)이 필요합니다.
**사파리에서 `공유 → 홈 화면에 추가`** 가 사실상 유일하고 충분한 방법입니다.
