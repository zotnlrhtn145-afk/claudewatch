#!/bin/bash
# 이 맥에서 클로드워치를 설치할 수 있는지 확인합니다.
#
#   bash scripts/check-env.sh
#
# 고칠 수 있는 것과 못 고치는 것을 나눠서 보여 줍니다.
# 이걸 먼저 돌려야 헛수고를 안 합니다.

OK="  ✅"; WARN="  ⚠️ "; BAD="  ❌"
BLOCKERS=0

echo
echo "  클로드워치 설치 환경 점검"
echo "  ──────────────────────────────────────────"
echo
echo "  [맥]"

# ── macOS · Xcode ──
if xcodebuild -version >/dev/null 2>&1; then
  echo "$OK Xcode $(xcodebuild -version | head -1 | awk '{print $2}')"
else
  echo "$BAD Xcode 없음 — App Store 에서 설치하세요"; BLOCKERS=$((BLOCKERS+1))
fi

# ── Node ──
if command -v node >/dev/null 2>&1; then
  NV=$(node -v | tr -d 'v' | cut -d. -f1)
  [ "$NV" -ge 20 ] 2>/dev/null && echo "$OK Node $(node -v)" \
    || { echo "$BAD Node $(node -v) — 20 이상이 필요합니다"; BLOCKERS=$((BLOCKERS+1)); }
else
  echo "$BAD Node 없음 — brew install node"; BLOCKERS=$((BLOCKERS+1))
fi

# ── 서명 인증서 (Xcode 에 애플 계정이 로그인돼 있는지) ──
if security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Development"; then
  echo "$OK 개발용 서명 인증서 있음"
else
  echo "$WARN 서명 인증서 없음 — Xcode → Settings → Accounts 에서 Apple ID 로그인 필요"
fi

# ── jq (터미널 세션 승인 훅에 필요) ──
command -v jq >/dev/null 2>&1 && echo "$OK jq" || echo "$WARN jq 없음 — brew install jq (터미널 세션 승인 기능에 필요)"

echo
echo "  [네트워크]"

# ── Tailscale ──
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
if [ -x "$TS" ]; then
  if perl -e 'alarm 15; exec @ARGV' "$TS" status >/dev/null 2>&1; then
    echo "$OK Tailscale 로그인됨"
    FUNNEL=$(perl -e 'alarm 15; exec @ARGV' "$TS" funnel status 2>/dev/null | grep -oE 'https://[a-z0-9.-]+\.ts\.net' | head -1)
    [ -n "$FUNNEL" ] && echo "$OK Funnel 켜짐 — $FUNNEL" \
      || echo "$WARN Funnel 꺼짐 — 설치 중에 켭니다"
  else
    echo "$WARN Tailscale 설치됨, 로그인 안 됨 — 앱을 열어 로그인하세요"
  fi
else
  echo "$WARN Tailscale 없음 — 설치 중에 깝니다 (brew install --cask tailscale-app)"
fi

echo
echo "  [아이폰]"

IPHONE=$(xcrun devicectl list devices 2>/dev/null | grep -i "iPhone" | head -1)
if [ -z "$IPHONE" ]; then
  echo "$BAD 아이폰이 안 보입니다"
  echo "       → USB 로 맥에 연결하고 아이폰에서 '이 컴퓨터를 신뢰' 를 누르세요"
  echo "       → 워치는 아이폰을 통해야 맥에 잡힙니다"
  BLOCKERS=$((BLOCKERS+1))
else
  STATE=$(echo "$IPHONE" | grep -oE "connected|available|unavailable|pairing" | head -1)
  case "$STATE" in
    connected) echo "$OK 아이폰 연결됨" ;;
    available) echo "$WARN 아이폰 발견됨, 아직 연결 안 됨 — 잠금을 풀어 주세요" ;;
    *)         echo "$WARN 아이폰 상태: $STATE — 잠금 해제 후 '신뢰' 를 누르세요" ;;
  esac
  ID=$(echo "$IPHONE" | awk '{print $3}')
  DM=$(xcrun devicectl device info details --device "$ID" 2>/dev/null | grep -i developerModeStatus | awk '{print $NF}')
  [ "$DM" = "enabled" ] && echo "$OK 아이폰 개발자 모드 켜짐" \
    || echo "$WARN 아이폰 개발자 모드 꺼짐 — 설정 → 개인정보 보호 및 보안 → 개발자 모드"
fi

echo
echo "  [애플워치]"

WATCH=$(xcrun devicectl list devices 2>/dev/null | grep -i "watch" | head -1)
if [ -z "$WATCH" ]; then
  echo "$BAD 워치가 안 보입니다"
  echo "       확인할 것:"
  echo "       1. 워치가 맥과 **같은 Wi-Fi** 에 붙어 있나요? (워치 설정 → Wi-Fi)"
  echo "       2. 아이폰 블루투스를 꺼 보세요 — 아이폰이 가까우면 워치가"
  echo "          블루투스를 쓰느라 Wi-Fi 에 안 붙습니다"
  echo "       3. 워치를 충전기에 올리고 화면을 켜 두세요 (잠긴 워치는 안 잡힙니다)"
  BLOCKERS=$((BLOCKERS+1))
else
  WID=$(echo "$WATCH" | awk '{print $3}')
  STATE=$(echo "$WATCH" | grep -oE "connected \(no DDI\)|connected|available \(paired\)|available|unavailable" | head -1)
  MODEL=$(echo "$WATCH" | grep -oE "Watch[0-9,]+" | head -1)
  echo "$OK 워치 발견 — 상태: $STATE"

  INFO=$(xcrun devicectl device info details --device "$WID" 2>/dev/null)
  OSV=$(echo "$INFO" | grep -i osVersionNumber | awk '{print $NF}')
  DM=$(echo "$INFO" | grep -i developerModeStatus | awk '{print $NF}')

  if [ -n "$OSV" ]; then
    MAJOR=${OSV%%.*}
    [ "$MAJOR" -ge 10 ] 2>/dev/null && echo "$OK watchOS $OSV (10 이상)" \
      || { echo "$BAD watchOS $OSV — 10 이상이 필요합니다"; BLOCKERS=$((BLOCKERS+1)); }
    [ "$MAJOR" -ge 11 ] 2>/dev/null && echo "$OK 더블 탭 승인 사용 가능 (watchOS 11+)" \
      || echo "$WARN 더블 탭 승인 불가 (watchOS 11+ 필요) — 화면 탭으로 승인하면 됩니다"
  fi

  [ "$DM" = "enabled" ] && echo "$OK 워치 개발자 모드 켜짐" \
    || echo "$WARN 워치 개발자 모드 꺼짐 — 설정 → 개인정보 보호 및 보안 → 개발자 모드"
fi

echo
echo "  ──────────────────────────────────────────"
if [ "$BLOCKERS" -eq 0 ]; then
  echo "  설치를 진행할 수 있습니다."
else
  echo "  ❌ 먼저 해결해야 할 것이 $BLOCKERS 건 있습니다. 위 항목을 보세요."
fi
echo
exit "$BLOCKERS"
