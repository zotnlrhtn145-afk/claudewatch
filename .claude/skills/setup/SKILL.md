---
name: setup
description: 클로드워치를 이 맥에 설치합니다. Tailscale·브리지·APNs·워치 앱까지 순서대로 진행합니다. 사용자가 "설치", "setup", "처음 설정" 을 요청하면 사용하세요.
---

# 클로드워치 설치

사용자의 맥과 애플워치에 클로드워치를 설치합니다. **사용자는 개발자지만 이 프로젝트는 처음입니다.** 각 단계에서 무엇을 왜 하는지 한 줄로 알려 주고, 사용자가 직접 해야 하는 것(웹 로그인·비밀번호·워치 조작)은 명확히 구분해 주세요.

## 원칙

- **한 번에 한 단계.** 여러 단계를 몰아서 실행하지 마세요. 실패 지점을 못 찾습니다.
- **확인하고 넘어가기.** 각 단계 끝에 실제로 됐는지 명령으로 확인하세요. "됐을 겁니다" 라고 넘어가면 나중에 원인을 못 찾습니다.
- **사용자가 해야 하는 것은 대신 하려 들지 마세요.** Apple ID 로그인, 맥 비밀번호, 워치 조작은 사용자 몫입니다.
- 모든 안내는 한국어 존댓말로.

## 1단계 — 기기 확인 (제일 먼저)

**`docs/COMPATIBILITY.md` 를 읽고 사용자에게 세 가지를 확인시키세요.**
여기서 안 맞으면 뒤 단계를 다 해도 소용없습니다.

사용자에게 물어볼 것 — 워치의 `설정 → 일반 → 정보` 에서 봅니다.

1. **watchOS 버전이 10 이상인가**
   - 안 되면 Series 3 이하일 가능성이 큽니다. 이 앱은 못 씁니다.

2. **셀룰러 모델인가, Wi-Fi 전용 모델인가**
   - 모델명이 `GPS + Cellular` → 셀룰러. 아이폰 없이 LTE 로 어디서나 됩니다.
   - 모델명이 `GPS` 만 → **Wi-Fi 전용 모델**입니다.
     기능은 전부 동작하지만, **아이폰을 두고 나가면 아무것도 못 합니다.**
     집·사무실 안이나 아이폰이 주머니에 있을 때만 쓸 수 있다는 걸 먼저 알려 주세요.
     설치를 말릴 이유는 없습니다 — 책상 앞에서도 충분히 쓸모가 있습니다.

3. **Series 9 / Ultra 2 이상인가**
   - 이상이면 검지·엄지 두드림(더블 탭)으로 승인할 수 있습니다 (watchOS 11+ 필요).
   - **Series 8 이하 · SE · Ultra 1세대는 더블 탭이 안 됩니다.**
     앱은 정상 동작하고 화면을 눌러 승인하면 됩니다. 미리 알려 줘야
     "왜 안 되지" 하고 헤매지 않습니다.

## 2단계 — 환경 자동 점검

**묻지 말고 먼저 이걸 돌리세요.** 무엇이 준비됐고 무엇이 막혀 있는지 한 번에 나옵니다.

```bash
bash scripts/check-env.sh
```

맥(Xcode·Node·서명 인증서)·네트워크(Tailscale·Funnel)·아이폰·워치를 전부 확인하고,
`❌` 는 반드시 고쳐야 하는 것, `⚠️` 는 설치 중에 처리하면 되는 것으로 나눠 줍니다.

### 자주 나오는 `❌` 와 대처

**"아이폰이 안 보입니다"**
워치는 아이폰을 통해야 맥에 잡힙니다. 아이폰을 USB 로 연결하고 잠금을 푼 뒤
**"이 컴퓨터를 신뢰"** 를 누르게 하세요. 그래도 안 잡히면:

```bash
xcrun devicectl manage pair --device <아이폰ID>
```

**"워치가 안 보입니다"** ← 여기서 제일 많이 막힙니다
워치는 **아이폰이 가까이 있으면 블루투스를 쓰느라 Wi-Fi 에 안 붙습니다.**
맥이 워치를 찾으려면 워치가 **맥과 같은 Wi-Fi** 에 있어야 합니다. 순서대로 안내하세요:

1. 워치 `설정 → Wi-Fi` 에서 맥과 같은 네트워크에 붙어 있는지 확인
2. **아이폰 블루투스를 잠깐 끄기** — 그래야 워치가 스스로 Wi-Fi 로 붙습니다
3. 워치를 충전기에 올리고 화면을 켜 두기 (잠긴 워치는 안 잡힙니다)
4. 다시 `bash scripts/check-env.sh`

설치가 끝나면 블루투스는 다시 켜도 됩니다.

**"개발자 모드 꺼짐"**
`설정 → 개인정보 보호 및 보안 → 개발자 모드` → 켜기 → 재시동 → 재시동 후 확인 창에서 **켜기**.
> 개발자 모드 항목이 **아예 안 보이면** 그 기기가 아직 Xcode 에 연결된 적이 없는 것입니다.
> 아이폰을 먼저 신뢰시키고 워치가 위 목록에 뜬 뒤에 다시 보세요.

**모두 `✅` 가 되면** 다음 단계로 넘어가세요. 그 전에는 넘어가지 마세요 —
뒤에서 실패하면 원인을 찾기 훨씬 어렵습니다.

애플 개발자 계정도 필요합니다. **무료 계정도 되지만 7일마다 재설치**해야 합니다.

## 3단계 — Tailscale (워치가 맥을 찾는 길)

애플워치에는 Tailscale 앱이 없습니다. 그래서 **Funnel** 로 맥의 브리지를 공개 주소로 내주고, 워치는 그 주소로 붙습니다.

```bash
brew install --cask tailscale-app
```

> 이 명령은 sudo 비밀번호가 필요합니다. 사용자에게 터미널에서 직접 실행하도록 안내하세요.

설치 후 사용자가 Tailscale 앱을 열어 로그인해야 합니다. 그다음:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg 8765
```

처음이면 브라우저 승인 창이 뜹니다. 승인 후 주소를 확인하세요:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel status
```

`https://<맥이름>.<tailnet>.ts.net` 형태의 주소를 기록해 둡니다. **이게 워치가 갈 주소입니다.**

## 4단계 — 브리지 설정

```bash
cd bridge && npm install
cp .env.example .env
```

토큰을 만들어 `.env` 의 `BRIDGE_TOKEN` 에 넣으세요:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

`.env` 에서 채워야 할 것:

- `BRIDGE_TOKEN` — 위에서 만든 값
- `BRIDGE_PROJECTS` — 워치에서 조종할 프로젝트 폴더들 (쉼표로 구분)
- `BRIDGE_KEEP_AWAKE=always` — **반드시 always 로 두세요.** 맥이 잠들면 워치가 못 닿습니다

## 5단계 — 애플 개발자 설정

사용자가 웹에서 직접 해야 합니다.

**팀 ID 확인** — <https://developer.apple.com/account> → Membership → Team ID (10자리)

**번들 ID 정하기** — 예: `com.본인이름.claudewatch.watchkitapp`

**APNs 키 발급** (푸시 알림용, 선택이지만 강력 권장)
1. <https://developer.apple.com/account/resources/authkeys/list> → **+**
2. **Apple Push Notifications service (APNs)** 체크 → Continue → Register
3. `.p8` 파일 다운로드 — **한 번만 받을 수 있습니다**
4. **저장소 밖**에 두세요 (예: `~/keys/`). 절대 커밋하지 마세요

받은 값으로 `.env` 를 채웁니다: `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`

## 6단계 — 자리표시자 채우기

소스에 `__TEAM_ID__`, `__BUNDLE_ID__`, `__BRIDGE_HOST__` 가 비어 있습니다. 아래 스크립트가 채웁니다:

```bash
bash scripts/configure.sh
```

물어보는 값: 팀 ID, 번들 ID, 브리지 주소(2단계에서 확인한 `.ts.net`)

## 7단계 — 브리지 켜기

```bash
cd bridge && npm run build && bash scripts/install-launchd.sh
```

이 스크립트는 등록 후 실제로 응답하는지 확인하고 끝납니다. 실패하면 오류를 그대로 보여줍니다.

확인:

```bash
curl -s http://127.0.0.1:8765/health
curl -s https://<맥이름>.<tailnet>.ts.net/health
```

둘 다 `{"ok":true}` 가 나와야 합니다.

## 8단계 — 워치 준비

**아이폰**: 설정 → 개인정보 보호 및 보안 → 개발자 모드 켜기 → 재시동

**워치**: 같은 경로로 개발자 모드 켜기 → 재시동
> 개발자 모드 항목은 기기가 Xcode 에 한 번 연결된 뒤에야 나타납니다. 안 보이면 아이폰을 맥에 USB 로 연결하고 신뢰한 다음 다시 보세요.

**중요**: 설치하려면 워치가 맥과 **같은 Wi-Fi** 에 있어야 합니다.
워치는 아이폰이 가까이 있으면 블루투스를 쓰고 Wi-Fi 에 안 붙습니다.
**아이폰 블루투스를 잠깐 꺼서** 워치가 스스로 Wi-Fi 에 붙게 하세요.

```bash
xcrun devicectl list devices
```

워치가 보이면 다음으로.

## 9단계 — 워치에 설치

```bash
cd watch
xcodebuild -project ClaudeWatch.xcodeproj -scheme ClaudeWatch \
  -destination 'generic/platform=watchOS' -allowProvisioningUpdates build
```

**codesign 이 멈춘 것처럼 보이면** 키체인 승인 창이 떠 있는 것입니다. 오류를 내지 않고 조용히 기다리므로 알아채기 어렵습니다:

```bash
bash bridge/scripts/watch-keychain-prompt.sh
```

사용자에게 **「항상 허용」** 을 누르라고 안내하세요. 「허용」만 누르면 다음에 또 물어봅니다.

빌드가 끝나면:

```bash
xcrun devicectl device install app --device <워치ID> <경로>/ClaudeWatch.app
```

## 10단계 — 워치와 페어링

워치에서 32자 토큰을 손으로 넣는 건 불가능합니다. 숫자 8자리로 대신합니다.

```bash
curl -s -X POST http://127.0.0.1:8765/pair/new
```

나온 8자리를 워치 앱 설정에 넣으면 토큰을 받아 갑니다. **3분 안에** 넣어야 합니다.

워치 앱에서 알림 권한을 **허용**해야 승인 푸시가 옵니다. 확인:

```bash
curl -s http://127.0.0.1:8765/health   # push: "on (1대)" 가 되면 등록 성공
```

## 11단계 — 맥 터미널 세션도 워치에서 승인하기 (선택)

이걸 켜면 터미널에서 돌던 클로드코드가 승인이 필요할 때 손목으로 옵니다.

`~/.claude/settings.json` 에 훅을 등록합니다. **사용자의 전역 설정이므로 반드시 먼저 물어보고, 백업한 뒤에 고치세요.**

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash|Write|Edit|MultiEdit|NotebookEdit",
      "hooks": [{
        "type": "command",
        "command": "<이 폴더 절대경로>/bridge/hooks/watch-approve.sh",
        "timeout": 120
      }]
    }]
  }
}
```

`jq` 가 필요합니다: `brew install jq`

> 브리지를 돌보는 세션은 `.env` 의 `BRIDGE_HOOK_SKIP` 에 세션 ID 를 넣어 제외하세요.
> 안 그러면 그 세션이 명령 쓸 때마다 손목이 울려 작업을 못 합니다.

## 마무리 확인

- 워치 앱에서 세션 목록이 보이는가
- 마이크로 지시를 보내면 대화창에 뜨고 답이 붙는가
- 승인 요청이 손목으로 오는가
- **LTE 시험**: 아이폰을 두고 Wi-Fi 밖으로 나가서 되는가

## 자주 막히는 곳

| 증상 | 원인 |
|---|---|
| 워치에 "맥에 닿지 않습니다" | 맥이 잠들었거나 브리지가 죽음. `BRIDGE_KEEP_AWAKE=always` 확인 |
| 빌드가 멈춤 | 키체인 승인 대기. `watch-keychain-prompt.sh` 로 확인 |
| 워치가 Xcode 에 안 보임 | 아이폰 블루투스를 끄고 워치를 Wi-Fi 에 붙이세요 |
| 개발자 모드 항목이 없음 | 기기가 Xcode 에 한 번 연결돼야 나타납니다 |
| 승인 알림이 안 옴 | 알림 권한 미허용. `/health` 의 push 가 `on (0대)` 면 미등록 |
