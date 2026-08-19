#!/bin/bash
# 브리지를 로그인할 때 자동으로 뜨게 등록합니다.
#
#   설치:  bash scripts/install-launchd.sh
#   해제:  bash scripts/install-launchd.sh --uninstall
#
# 등록 뒤에는 맥을 재시동해도 알아서 뜹니다. 죽으면 launchd 가 다시 띄웁니다.
set -euo pipefail

LABEL="com.claudewatch.bridge"
BRIDGE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$TARGET"
  echo "· 등록을 해제했습니다."
  exit 0
fi

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "✗ node 를 찾지 못했습니다."; exit 1; }
[ -f "$BRIDGE/dist/index.js" ] || { echo "✗ dist 가 없습니다. 먼저 'npm run build' 를 하세요."; exit 1; }
[ -f "$BRIDGE/.env" ] || { echo "✗ .env 가 없습니다. '.env.example' 을 복사해 채우세요."; exit 1; }

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/claudewatch"

# 자리표시자를 실제 경로로 바꿔 넣습니다.
sed -e "s#__NODE__#$NODE#g" \
    -e "s#__BRIDGE__#$BRIDGE#g" \
    -e "s#__HOME__#$HOME#g" \
    "$BRIDGE/launchd/$LABEL.plist" > "$TARGET"

# 이미 떠 있으면 내리고 새로 올립니다.
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# bootout 직후엔 아직 정리 중이라 bootstrap 이 실패할 수 있습니다.
sleep 2

# 직전 등록이 완전히 사라지기 전에 다시 올리면 "Bootstrap failed: 5" 가 납니다.
# 몇 초 기다렸다 다시 시도하면 됩니다. 이걸 안 해서 브리지가 죽은 채로
# 방치된 적이 여러 번 있었습니다.
for attempt in 1 2 3 4 5; do
  if launchctl bootstrap "$DOMAIN" "$TARGET" 2>/tmp/claudewatch-bootstrap.err; then
    BOOTSTRAPPED=1
    break
  fi
  [ "$attempt" -lt 5 ] && sleep 3
done

if [ "${BOOTSTRAPPED:-}" != "1" ]; then
  echo "✗ launchd 등록에 실패했습니다 (5회 시도):"
  sed 's/^/    /' /tmp/claudewatch-bootstrap.err
  exit 1
fi
launchctl enable "$DOMAIN/$LABEL"

# **실제로 응답하는지 확인하고 끝냅니다.**
# 예전엔 등록 실패해도 "등록했습니다" 를 찍어서, 브리지가 죽은 줄 모르고
# 몇 시간을 보냈습니다. 워치에는 그냥 "브리지 오류" 로만 보입니다.
PORT=$(grep -E '^BRIDGE_PORT=' "$BRIDGE/.env" 2>/dev/null | cut -d= -f2 | tr -d ' ')
PORT=${PORT:-8765}
for _ in $(seq 1 20); do
  if curl -s -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    OK=1; break
  fi
  sleep 1
done

if [ "${OK:-}" != "1" ]; then
  echo "✗ 등록은 됐지만 브리지가 응답하지 않습니다."
  echo "   로그를 보세요: tail -20 $HOME/Library/Logs/claudewatch/bridge.log"
  exit 1
fi

echo "· 등록했습니다: $TARGET  (응답 확인됨)"
echo "·   로그:   $HOME/Library/Logs/claudewatch/bridge.log"
echo "·   상태:   launchctl print $DOMAIN/$LABEL | head -20"
echo "·   해제:   bash scripts/install-launchd.sh --uninstall"
