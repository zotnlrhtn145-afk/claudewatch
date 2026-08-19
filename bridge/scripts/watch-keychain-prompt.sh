#!/bin/bash
# 코드 서명이 키체인 허용 창을 기다리는 중인지 알려 줍니다.
#
# codesign 은 키체인 승인이 필요하면 조용히 멈춥니다. 오류도 안 내고,
# 창이 다른 창에 가려지거나 화면이 잠겨 있으면 아무도 모른 채 몇십 분이 흘러갑니다.
# 실제로 그렇게 세 번 날렸습니다.
#
#   bash scripts/watch-keychain-prompt.sh
#
# 멈춰 있으면 무엇을 눌러야 하는지 알려 주고, 아니면 조용히 끝납니다.
# 명령줄 전체(-f)로 찾으면 "codesign" 이라는 글자가 든 **내 셸 자신**까지 잡힙니다.
# 실제로 오탐이 나서 있지도 않은 대기를 있다고 알린 적이 있습니다.
# 실행 파일 이름이 정확히 codesign 인 프로세스만 셉니다.
STUCK=$(ps -Ao pid,comm | awk '$2 ~ /\/codesign$/ {print $1; exit}')
[ -n "$STUCK" ] || { echo "· codesign 대기 없음"; exit 0; }

SECS=$(ps -o etime= -p "$STUCK" 2>/dev/null | tr -d ' ')
LOCKED=$(python3 -c "
import subprocess,plistlib
d=plistlib.loads(subprocess.run(['ioreg','-n','Root','-d1','-a'],capture_output=True).stdout)
print(d.get('IOConsoleUsers',[{}])[0].get('CGSSessionScreenIsLocked',False))" 2>/dev/null)

echo "⚠️  codesign 이 ${SECS} 째 키체인 승인을 기다리고 있습니다."
echo
if [ "$LOCKED" = "True" ]; then
  echo "   맥 화면이 잠겨 있습니다. 잠금을 풀면 허용 창이 뜹니다."
else
  echo "   화면에 이 창이 떠 있을 겁니다 (다른 창에 가려졌을 수 있습니다):"
fi
echo '   "codesign이(가) 키체인에 저장된 키 ... 을(를) 사용하려고 합니다"'
echo
echo "   → [항상 허용] 을 누르세요. [허용] 만 누르면 다음에 또 물어봅니다."
echo
echo "   매번 안 뜨게 하려면 (암호를 직접 넣으셔야 합니다):"
echo "   security set-key-partition-list -S apple-tool:,apple:,codesign: \\"
echo "     -s -k '맥_로그인_암호' ~/Library/Keychains/login.keychain-db"
