# 클로드워치 (ClaudeWatch)

**Made by 오수환 · © 뚝딱컴퍼니**

애플워치(LTE)로 맥에서 도는 클로드코드를 조종합니다.
맥 근처가 아니어도 세션 확인 · 승인/거부 · 음성 지시 · 새 세션 생성이 됩니다.

## 설치

이 폴더에서 클로드코드를 열고 **`/setup`** 을 실행하세요. 순서대로 안내합니다.

준비물: 맥(Xcode) · 애플워치(watchOS 10+) · 애플 개발자 계정 · Tailscale 계정(무료)

**어떤 워치에서 되는지 먼저 확인하세요 → [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md)**
기기별로 더블 탭 지원 여부와, Wi-Fi 만 있을 때 어디까지 되는지 정리해 뒀습니다.

> 무료 개발자 계정도 됩니다. 다만 **7일마다 재설치**해야 합니다.

---


## 지금 되는 것

| | 상태 |
|---|---|
| 브리지 서버 (세션 생성·목록·상세·로그) | ✅ 실기동 검증됨 |
| 승인 요청 감지 → 승인/거부 | ✅ 실기동 검증됨 |
| 워치용 3~4줄 결과 요약 | ✅ 실기동 검증됨 |
| 음성 지시 (`/prompt`) | ✅ 실기동 검증됨 |
| watchOS 앱 6개 화면 | ✅ 빌드 성공, 시뮬레이터 설치·실행 확인 |
| 공식 앱 세션 동기화 (`remote-control`) | ✅ 종단 검증됨 — 아래 6번 |
| APNs 푸시 | ⚠️ 코드 완성, **`.p8` 키 발급 후 확인 필요** |
| 워치→맥 연결 (Tailscale Funnel) | ⚠️ **맥에 아직 설치 안 됨** — 아래 2번 |

---

## 1. 브리지 서버 켜기

```bash
cd ~/claudewatch/bridge && npm install
```

```bash
cd ~/claudewatch/bridge && cp .env.example .env
```

토큰을 만들어 `.env` 의 `BRIDGE_TOKEN` 에 넣으세요.

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

```bash
cd ~/claudewatch/bridge && npm run dev
```

뜨면 이렇게 나옵니다. `100.` 으로 시작하는 주소가 워치가 붙을 곳입니다.

```
· 브리지 서버가 떴습니다 — 드라이버 sdk
·   http://100.x.y.z:8765 ← Tailscale
·   프로젝트 3개, 푸시 꺼짐(APNS_* 미설정)
```

### 잘 도는지 확인

```bash
curl -s http://127.0.0.1:8765/health
```

---

## 2. 워치 → 맥 연결 (Tailscale Funnel)

> **애플워치에는 Tailscale 을 설치할 수 없습니다.**
> App Store 의 Tailscale 은 iPhone · iPad · Mac · Apple TV · Vision Pro 만 지원하고
> watchOS 판이 없습니다. 그래서 "워치를 tailnet 에 넣는다" 는 계획은 성립하지 않습니다.
> 확인: <https://apps.apple.com/us/app/tailscale/id1470499037>

대신 **Funnel** 을 씁니다. tailnet 의 서비스를 공개 인터넷에 진짜 TLS 인증서와 함께 내주는 기능이라,
**접속하는 쪽(워치)에는 아무것도 설치하지 않아도 됩니다.**

1. 맥에 Tailscale 설치 후 로그인

```bash
brew install --cask tailscale-app
```

2. 브리지를 Funnel 로 내주기 (처음 한 번은 브라우저 승인 창이 뜹니다)

```bash
tailscale funnel 8765
```

3. 나온 주소를 워치 앱 설정에 그대로 넣기

```
https://<맥이름>.<tailnet이름>.ts.net
```

Funnel 이 듣는 포트는 443 · 8443 · 10000 뿐입니다. 위 명령은 공개 443 을 로컬 8765 로 넘깁니다.
문서: <https://tailscale.com/kb/1223/funnel>

### 이 방식의 대가

브리지가 공개 인터넷에 열립니다. 그래서 **`BRIDGE_TOKEN` 이 유일한 방어선입니다.**
24바이트 랜덤이라 추측 강도는 충분하지만, 무제한 시도를 막는 장치는 아직 없습니다.

얻는 것도 있습니다 — 진짜 Let's Encrypt 인증서가 붙으므로
워치 앱의 ATS 예외(`NSAllowsArbitraryLoads`)가 **필요 없어집니다.**

---

## 3. 워치 앱

```bash
open ~/claudewatch/watch/ClaudeWatch.xcodeproj
```

- 번들 ID: `__BUNDLE_ID__`
- 팀: `__TEAM_ID__`
- 최소 버전: watchOS 10

시뮬레이터 런타임(watchOS 26.5)은 이미 내려받아 뒀습니다. 명령줄로 돌리려면:

```bash
cd ~/claudewatch/watch && xcodebuild -project ClaudeWatch.xcodeproj -scheme ClaudeWatch -destination 'platform=watchOS Simulator,name=Apple Watch Series 11 (46mm)' CODE_SIGNING_ALLOWED=NO build
```

> `Info.plist` 의 `WKWatchOnly` 는 지우지 마세요. 이게 없으면 "짝이 되는 아이폰 앱을 대라"며
> 설치가 거부됩니다. 반대로 `WKRunsIndependentlyOfCompanionApp` 을 같이 두면 뜻이 모호하다고 또 거부됩니다.

런타임 없이 코드만 검증하려면:

```bash
cd ~/claudewatch/watch && xcrun --sdk watchsimulator swiftc -typecheck -target arm64-apple-watchos10.0-simulator -sdk $(xcrun --sdk watchsimulator --show-sdk-path) $(find ClaudeWatch -name "*.swift")
```

### 화면

| 화면 | 하는 일 |
|---|---|
| 세션 목록 | 상태 점 + 이름 + 경과 시간. **승인 대기는 카드 안에서 바로 승인/거부** |
| 세션 상세 | 상태 태그 + 3~4줄 요약 + [지시] [전체 로그] |
| 전체 로그 | 최근 120줄 |
| 지시 | 마이크 버튼 → 시스템 받아쓰기 → 전송 |
| 새 세션 | 프로젝트 선택 + 첫 지시 |
| 설정 | 브리지 주소(UserDefaults) + 토큰(**키체인**) |

> watchOS 는 서드파티 앱에 마이크 파형이나 실시간 인식 텍스트를 열어 주지 않습니다.
> 그래서 기획안의 "음성 파형" 은 시스템 받아쓰기 화면이 대신합니다. 동작은 같습니다.

### 더블 탭으로 승인

엄지+검지를 두 번 맞대면 승인됩니다. 화면을 안 봐도 손목 동작만으로 끝납니다.

| | |
|---|---|
| 기기 | Apple Watch **Series 9 / Ultra 2 이상** |
| OS | **watchOS 11+** (앱 최소는 10.0 이라 `#available` 로 분기) |
| 안 되는 기기 | 아무 일도 안 일어남 — 화면을 누르면 됩니다 |

**손목 돌리기 같은 다른 제스처는 쓸 수 없습니다.** watchOS 가 앱에 열어 주는 손 제스처는
더블 탭 하나뿐이고, 나머지(꽉 쥐기·손목 회전)는 손쉬운 사용 전용으로 예약돼 있습니다.
CoreMotion 으로 직접 회전을 읽는 방법은 있지만, 손목은 하루 종일 돌아가므로
**오작동으로 위험한 명령이 승인될 수 있어** 쓰지 않았습니다.

#### 두 가지 안전장치

**1. 위험한 명령은 더블 탭이 안 먹습니다.** `risky` 인 승인 요청은 화면을 직접 눌러야 합니다.
   왜 안 되는지 모르면 고장으로 오해하므로 "화면을 눌러야 승인됩니다" 를 같이 띄웁니다.

**2. 승인 대기가 여럿이면 맨 위 하나만 잡습니다.** 그리고 그 맨 위가 위험한 명령이면
   **아무것도 잡지 않습니다.** 아래의 안전한 항목으로 넘겨 버리면, 화면에는 위험한 카드가
   보이는데 손목 동작은 엉뚱한 걸 승인하게 됩니다. 그게 제일 나쁜 실패입니다.

**3. 승인 직후 2.5초는 더블 탭이 안 잡힙니다.** 승인 대기가 여러 개 쌓여 있을 때
   연달아 두 번 맞대면 목록이 갱신되면서 **읽지도 않은 다음 승인이 통과합니다.**
   손목에서 뭐가 승인됐는지 모른 채 지나가는 게 제일 위험합니다.
   화면을 직접 누르는 건 그대로 됩니다 — 그건 보고 누르는 거니까요.

거부는 더블 탭에 붙이지 않았습니다 — 한 화면에 primary action 은 하나뿐이고, 그 하나는 승인이 맞습니다.

#### 알림에서는 다릅니다

알림에 대한 더블 탭은 **알림을 여는 동작**이고(긴 알림이면 한 번 더 하면 스크롤),
알림의 [승인] [거부] 버튼은 시스템 UI라 `handGestureShortcut` 를 붙일 수 없습니다.
그래서 알림이 여러 개 쌓여도 더블 탭 연타로 줄줄이 승인되지는 않습니다.

### 맥 터미널 세션도 워치에서

터미널에서 직접 띄운 세션(위드트립·위드택스 등)은 브리지의 자식이 아니라
키를 밀어 넣을 수 없습니다. 그래도 세 가지가 다 됩니다.

| | 방법 |
|---|---|
| **승인·거부** | `PreToolUse` 훅이 실행 직전에 브리지로 물어보고, 워치의 답을 돌려줍니다 |
| **대화 내용 보기** | 클로드코드가 남긴 기록(`~/.claude/projects/…jsonl`)을 끝에서 잘라 읽습니다 |
| **음성 지시** | 세션끼리 주고받는 `SendMessage` 로 **그 세션 안에** 넣습니다 |

지시는 **새 세션을 만들지 않습니다.** 노트북에서 리모트컨트롤로 말을 걸 때처럼
그 세션의 대화에 그대로 들어가고, 그 세션이 이어서 작업합니다.

#### 여기서 두 번 크게 틀렸습니다

**1. `resume` 으로 대화를 물려주면 안 됩니다.**
새 에이전트가 "나는 이 작업을 하던 중"이라고 판단해 **이전 명령들을 다시 실행합니다.**
그중에 세션을 만드는 명령이 있어 무한히 번졌습니다. 실제로 두 번 겪었습니다.

**2. 전달자의 권한 모드가 받는 쪽과 같아야 합니다.**
`bypassPermissions` 로 띄우면 받는 세션과 permission-mode class 가 어긋나서
메시지가 **배달되지 않고 그쪽에서 승인 대기로 걸립니다.** 조용히 실패해서
"전달 완료" 라고 나오는데 상대는 못 받습니다. `default` 로 맞춰야 합니다.

전달자(`sessions/relay.ts`)는 도구를 `SendMessage` · `ListAgents` 둘로 묶어 두고
턴 수도 제한합니다. 셸도 파일도 만지지 못합니다. 전달할 문장은 해석하지 말라고
명시합니다 — 그건 받는 쪽이 할 일입니다.

### 끊겼을 때

무엇이 끊겼는지 구분해서 보여 줍니다. "연결 실패" 한 마디로 뭉치면
맥을 켜야 하는지 신호를 찾아야 하는지 알 수 없습니다.

| 상황 | 워치 배너 |
|---|---|
| 워치가 네트워크에 못 나감 | 워치가 네트워크에 연결돼 있지 않습니다 |
| 맥이 꺼짐 · 브리지 안 뜸 · Tailscale 끊김 | 맥에 닿지 않습니다 |
| 맥이 응답 없음 | 맥이 응답하지 않습니다 |
| 토큰 불일치 | 토큰이 맞지 않습니다 → [설정 열기] |

끊겨도 목록을 지우지 않습니다. 대신 **흐리게 칠하고 "아래는 3분 전 화면입니다"** 를 붙입니다.
낡은 화면을 지금 상태로 착각하고 승인을 누르는 게 제일 위험합니다.

### 폴링 주기

급한 일은 푸시가 알려 주므로, 폴링은 화면을 맞추는 용도입니다. 볼 게 없으면 느리게 갑니다.

| 상태 | 주기 |
|---|---|
| 승인 대기 있음 | 3초 |
| 실행 중 | 6초 |
| 전부 대기·완료 | 20초 |
| 연결 실패 | 6 → 12 → 24 → 30초 (물러섬) |

화면이 꺼지면 폴링도 멈춥니다 (`scenePhase`). 워치 배터리에서는 이게 제일 큽니다.

---

## 4. APNs 푸시 (남은 일)

1. [Apple Developer → Keys](https://developer.apple.com/account/resources/authkeys/list) 에서
   **Apple Push Notifications service (APNs)** 키 생성 → `.p8` 다운로드
2. `.p8` 은 **저장소 밖**에 두세요 (예: `~/keys/AuthKey_XXXX.p8`). 커밋 금지.
3. `.env` 채우기:

```
APNS_KEY_PATH=$HOME/keys/AuthKey_XXXXXXXXXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=__TEAM_ID__
APNS_BUNDLE_ID=__BUNDLE_ID__
APNS_ENV=sandbox
```

키를 안 넣어도 나머지 기능은 전부 돕니다 — 푸시만 조용히 건너뜁니다.
워치 앱이 실기기에서 뜨면 알아서 `/devices` 로 기기 토큰을 등록합니다.

---

## 5. API

인증: `Authorization: Bearer <BRIDGE_TOKEN>` (`/health` 만 예외)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 살아 있는지 (토큰 불필요) |
| GET | `/projects` | 고를 수 있는 프로젝트 |
| GET | `/sessions` | 목록 — **승인 대기가 항상 맨 위** |
| POST | `/sessions` | `{ project, firstPrompt }` |
| GET | `/sessions/:id` | 상세 + 요약 |
| GET | `/sessions/:id/log` | 전체 로그 (`?limit=`) |
| POST | `/sessions/:id/approve` | `{ approvalId }` |
| POST | `/sessions/:id/deny` | `{ approvalId }` |
| POST | `/sessions/:id/prompt` | `{ text }` |
| POST | `/sessions/:id/stop` | 세션 종료 |
| POST | `/devices` | `{ token }` APNs 기기 등록 |

`approvalId` 를 함께 보내면, 그 사이에 다른 승인 요청으로 바뀐 경우 `409` 로 막습니다.
**워치에서 본 명령과 실제로 승인되는 명령이 어긋나지 않게 하는 장치입니다.**

---

## 6. 세션 드라이버

`.env` 의 `BRIDGE_DRIVER` 로 바꿉니다.

| | `sdk` (기본) | `remote-control` |
|---|---|---|
| 실행 | Agent SDK `query()` | `claude --remote-control` (pty) |
| 승인 감지 | `canUseTool` 콜백 — 정확 | 터미널 화면 파싱 — 취약 |
| 공식 앱 동기화 | ✗ | ✓ |
| 실기동 검증 | ✅ | ✅ 2026-08-17, 클로드코드 2.1.233 |

원격제어는 연구 미리보기라 화면이 바뀔 수 있어서, 실행부를 `src/sessions/drivers/` 로 몰아 뒀습니다.
`remote-control` 을 쓰려면 `node-pty` 가 필요합니다 (`optionalDependencies`).

### remote-control 종단 검증 결과 (2026-08-17)

브리지를 통해 세션 생성 → 승인 대기 감지 → API 승인 → 파일 생성까지 확인했습니다.
거부(파일 안 생김)와 `409` 방어도 확인했습니다. 그 과정에서 찾아 고친 것들입니다.

**1. `--permission-mode manual` 이 없으면 승인 요청이 아예 안 뜹니다.**
세션이 `auto` 모드로 떠서 클로드코드가 알아서 승인해 버립니다.
워치가 승인할 게 없어지는 것은 물론이고, **위험한 명령도 그냥 실행됩니다.**
이 프로젝트에서 가장 중요한 한 줄입니다.

**2. TUI 는 공백 대신 커서 이동(`ESC[nG`)으로 단어를 배치합니다.**
ANSI 를 그냥 걷어내면 `Do you want to` 가 `Doyouwantto` 가 되어 정규식이 절대 안 맞습니다.
커서 이동을 먼저 공백으로 바꿔야 합니다.

**3. 시작 대화상자를 넘겨야 합니다.**
처음 여는 폴더면 "Quick safety check: Is this a project you trust?" 가 뜹니다.
Chrome 확장이 감지되면 그 확인도 뜹니다. 이걸 안 넘기면 **첫 지시가 대화상자에 먹힙니다.**
고정 시간 대기가 아니라 TUI 준비 신호를 보고 넣습니다.

**4. 부모의 `CLAUDE_*` 환경변수를 걷어내야 합니다.**
그대로 물려주면 자식 세션으로 취급돼 기록이 저장되지 않고 권한 모드도 새어 들어옵니다.

**5. 승인 키는 `1`, 거부는 `Esc` 입니다.**
숫자를 누르면 그 자리에서 확정되므로 `1\r` 처럼 Enter 를 붙이면 빈 입력이 한 번 더 들어갑니다.
`2. Yes, allow all edits during this session` 은 **절대 쓰지 않습니다** —
누르면 이후 승인이 워치를 거치지 않고 통과합니다.

**6. `node-pty` 1.1.0 은 `spawn-helper` 를 실행 권한 없이 배포합니다.**
그대로면 `pty.spawn()` 이 `posix_spawnp failed` 로 죽습니다. 원인이 전혀 드러나지 않는 실패라
`scripts/fix-node-pty.mjs` 를 `postinstall` 에 걸어 뒀습니다.

확인한 실제 승인 화면과, 워치가 받는 값:

```
⏺ Write(hello.txt)
  Create file hello.txt
  1  hello
Do you want to create hello.txt?
❯ 1. Yes
  2. Yes, allow all edits during this session (shift+tab)
  3. No
Esc to cancel · Tab to amend
```

```json
{ "toolName": "Write", "command": "Write(note.txt)",
  "title": "Do you want to create note.txt?", "risky": false }
```

> 확인 문구는 **줄 단위로 찾으면 안 됩니다.** TUI 가 화면을 제자리에서 다시 그리느라
> `\n` 을 거의 쓰지 않아서, 줄로 찾으면 시작 배너까지 통째로 워치에 실려 갑니다.
> 문장 정규식으로 뽑습니다.

### 공식 앱에서 이 폴더를 바로 조종하려면

브리지를 거치지 않고, 터미널에서 이렇게 켜면 핸드폰 클로드 앱에 바로 뜹니다.

```bash
cd ~/claudewatch && claude --remote-control claudewatch
```

(`~/.claude/settings.json` 에 `remoteControlAtStartup: true` 가 이미 있어서 이름만 붙이는 셈입니다.)

---

## 7. 맥 잠자기

맥이 잠들면 세션이 끊길 뿐 아니라 워치가 브리지에 아예 닿지 못합니다.
브리지가 살아 있는 세션이 있는 동안 `caffeinate` 를 물어 둡니다. `.env` 로 바꿉니다.

| `BRIDGE_KEEP_AWAKE` | 동작 |
|---|---|
| `sessions` (기본) | 살아 있는 세션이 있는 동안만 |
| `always` | 브리지가 떠 있는 내내 — 워치로 언제든 새 세션을 만들려면 이쪽 |
| `off` | 쓰지 않음 |

`starting` · `running` · `waiting_approval` · `idle` 을 "살아 있다"로 봅니다.
`idle` 도 포함하는 건 다음 지시를 워치에서 보낼 수 있어야 하기 때문입니다.
다 쓴 세션은 `POST /sessions/:id/stop` 으로 닫아야 맥이 다시 잠듭니다.

> **배터리로 돌면서 뚜껑을 닫으면 macOS 는 어떤 방법으로도 못 막습니다.**
> 나가 있는 동안 세션을 살려 두려면 맥을 전원에 꽂고 뚜껑을 열어 두세요.

---

## 8. 남은 일

- [ ] 맥에 Tailscale 설치 → `tailscale funnel 8765` → `.ts.net` 주소 확인
- [ ] APNs `.p8` 키 발급 → 푸시 실제 확인
- [ ] Xcode 서명 + Push Notifications capability → 워치에 설치
- [ ] 실기기(LTE 단독) 테스트 — 아이폰을 꺼 두고 승인까지 되는지
- [ ] Funnel 로 공개되므로 토큰 시도 제한(rate limit) 넣기
- [ ] ATS 예외(`NSAllowsArbitraryLoads`) 제거 — Funnel 인증서가 진짜라 불필요
- [x] ~~watchOS 시뮬레이터 런타임 → 실행 확인~~
- [x] ~~맥이 잠들면 세션이 끊기는 문제~~ (`BRIDGE_KEEP_AWAKE`, 위 7번)
- [x] ~~맥 꺼짐·네트워크 끊김 시 워치에 상태 표시~~
- [x] ~~배터리 최적화: 폴링 최소화, 푸시 중심 갱신~~
