# 클로드워치 (ClaudeWatch)

애플워치로 맥에서 실행 중인 클로드코드를 원격 조종하는 시스템입니다.
맥 근처가 아니어도 LTE 만으로 세션 확인 · 승인/거부 · 음성 지시가 됩니다.

Made by 오수환 · © 뚝딱컴퍼니

---

## 아직 설치 안 했다면

`/setup` 을 실행하세요. 순서대로 안내합니다.

## 이 저장소를 다룰 때

- **항상 한국어 존댓말**로 응답하세요.
- **비밀값 절대 출력 금지** — APNs `.p8`, 브리지 토큰, Tailscale 인증키.
  `.env` 와 `*.p8` 은 `.gitignore` 에 있습니다. 커밋하지 마세요.
- **사용자가 지금 쓰고 있는 것을 망가뜨리지 마세요.** 브리지를 재시작했으면
  반드시 `/health` 와 공개 주소가 응답하는지 확인하고 끝내세요. 브리지가 죽어
  있으면 사용자는 밖에서 손목으로 아무것도 못 합니다.

## 구조

```
bridge/          맥에서 도는 브리지 서버 (Node + TypeScript)
  src/sessions/drivers/   세션 실행 드라이버 (교체 가능)
  src/api/                REST API
  src/push/               APNs
  hooks/                  터미널 세션의 승인을 워치로 넘기는 훅
watch/           watchOS 앱 (SwiftUI)
```

## 설계에서 지킬 것

- **세션 실행부는 드라이버로 분리.** 원격제어는 연구 미리보기라 동작이 바뀝니다.
  `sessions/drivers/` 안에서만 갈아끼울 수 있게 유지하세요.
- **워치 화면은 작습니다.** 텍스트는 짧게, 승인은 탭 한 번으로.
- **위험한 명령(삭제·배포)은 승인 화면에 원문을 반드시 표시.**
  `sessions/risky.ts` 가 판정합니다. 애매하면 위험 쪽으로 판정하세요 —
  잘못 걸러 한 번 더 누르는 건 불편할 뿐이지만, 못 걸러서 운영 배포가
  손목 두 번에 나가는 건 되돌릴 수 없습니다.

## 명령어

```bash
cd bridge && npm run dev              # 개발 모드
cd bridge && npm run build            # 타입 체크 + 빌드
bash bridge/scripts/install-launchd.sh   # 상시 가동 등록
```

```bash
cd watch && xcodebuild -project ClaudeWatch.xcodeproj -scheme ClaudeWatch \
  -destination 'generic/platform=watchOS' -allowProvisioningUpdates build
```

빌드가 멈춘 것처럼 보이면 키체인 승인 대기입니다:
```bash
bash bridge/scripts/watch-keychain-prompt.sh
```
