#!/bin/bash
# 소스에 비어 있는 자리표시자를 이 맥의 값으로 채웁니다.
#
#   bash scripts/configure.sh
#
# 채우는 것: 애플 팀 ID · 번들 ID · 브리지 공개 주소
# 이미 채워져 있으면 현재 값을 기본값으로 보여 줍니다.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PBX="watch/ClaudeWatch.xcodeproj/project.pbxproj"
PLIST="watch/ClaudeWatch/Info.plist"

current() { grep -oE "$2" "$1" 2>/dev/null | head -1 | sed "s/$3//" ; }

echo "클로드워치 설정"
echo

# ── 팀 ID ──
NOW=$(grep -oE 'DEVELOPMENT_TEAM = [^;]*' "$PBX" | head -1 | sed 's/DEVELOPMENT_TEAM = //')
echo "애플 개발자 팀 ID (10자리)"
echo "  developer.apple.com/account → Membership → Team ID"
read -r -p "  [$NOW]: " TEAM
TEAM=${TEAM:-$NOW}
[ -n "$TEAM" ] && [ "$TEAM" != "__TEAM_ID__" ] || { echo "✗ 팀 ID 가 필요합니다."; exit 1; }

# ── 번들 ID ──
NOW=$(grep -oE 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*' "$PBX" | head -1 | sed 's/PRODUCT_BUNDLE_IDENTIFIER = //')
echo
echo "번들 ID (본인 것으로. 예: com.myname.claudewatch.watchkitapp)"
read -r -p "  [$NOW]: " BUNDLE
BUNDLE=${BUNDLE:-$NOW}
[ -n "$BUNDLE" ] && [ "$BUNDLE" != "__BUNDLE_ID__" ] || { echo "✗ 번들 ID 가 필요합니다."; exit 1; }

# ── 브리지 주소 ── Tailscale 이 이미 켜져 있으면 알아서 찾습니다
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
GUESS=""
if [ -x "$TS" ]; then
  GUESS=$("$TS" funnel status 2>/dev/null | grep -oE 'https://[a-z0-9.-]+\.ts\.net' | head -1 | sed 's#https://##')
fi
NOW=$(grep -A1 'BridgeDefaultHost' "$PLIST" | grep -oE '<string>[^<]*' | sed 's/<string>//')
[ -n "$GUESS" ] && NOW="$GUESS"
echo
echo "브리지 공개 주소 (tailscale funnel status 에 나온 .ts.net 주소)"
read -r -p "  [$NOW]: " HOST
HOST=${HOST:-$NOW}
HOST=${HOST#https://}
[ -n "$HOST" ] && [ "$HOST" != "__BRIDGE_HOST__" ] || { echo "✗ 주소가 필요합니다. 먼저 tailscale funnel 을 켜세요."; exit 1; }

# ── 채우기 ──
python3 - "$TEAM" "$BUNDLE" "$HOST" <<'PY'
import pathlib, re, sys
team, bundle, host = sys.argv[1], sys.argv[2], sys.argv[3]

pbx = pathlib.Path("watch/ClaudeWatch.xcodeproj/project.pbxproj")
s = pbx.read_text()
s = re.sub(r'DEVELOPMENT_TEAM = [^;]*;', f'DEVELOPMENT_TEAM = {team};', s)
s = re.sub(r'PRODUCT_BUNDLE_IDENTIFIER = [^;]*;', f'PRODUCT_BUNDLE_IDENTIFIER = {bundle};', s)
pbx.write_text(s)

pl = pathlib.Path("watch/ClaudeWatch/Info.plist")
s = pl.read_text()
s = re.sub(r'(<key>BridgeDefaultHost</key>\s*<string>)[^<]*(</string>)', rf'\g<1>{host}\g<2>', s)
pl.write_text(s)

env = pathlib.Path("bridge/.env")
if env.exists():
    s = env.read_text()
    s = s.replace("__TEAM_ID__", team).replace("__BUNDLE_ID__", bundle)
    env.write_text(s)
print("채웠습니다.")
PY

echo
echo "  팀 ID   : $TEAM"
echo "  번들 ID : $BUNDLE"
echo "  주소    : $HOST"
echo
echo "다음: cd bridge && npm run build && bash scripts/install-launchd.sh"
