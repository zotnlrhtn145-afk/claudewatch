#!/bin/bash
# 맥에서 도는 클로드코드 세션의 승인을 애플워치로 넘깁니다.
#
# 클로드코드가 도구를 실행하기 직전에 이 스크립트를 부릅니다(PreToolUse).
# 여기서 브리지에 물어보고, 워치에서 누른 결과를 그대로 돌려줍니다.
#
#   터미널 세션 → 이 훅 → 브리지 → 푸시 → ⌚ 승인/거부 → 여기로 회신
#
# 설계 원칙: **워치 때문에 맥 작업이 막히면 안 됩니다.**
#   - 브리지가 꺼져 있으면 즉시 빠집니다 (평소대로 터미널이 물어봄)
#   - 워치가 등록돼 있지 않으면 즉시 빠집니다
#   - 정해진 시간 안에 답이 없으면 빠집니다
#   - 어떤 오류가 나도 "결정 없음"으로 빠집니다 — 조용히 통과시키지 않습니다
#
# "결정 없음"(exit 0 + 출력 없음)은 클로드코드의 평소 권한 흐름을 그대로 탑니다.

BRIDGE="${CLAUDEWATCH_BRIDGE:-http://127.0.0.1:8765}"
# 워치가 답할 때까지 기다리는 시간. 훅 자체 제한(settings.json의 timeout)보다 짧아야 합니다.
WAIT_MS="${CLAUDEWATCH_WAIT_MS:-90000}"

INPUT=$(cat)

# jq 가 없으면 아무것도 하지 않습니다. 훅이 사용자 작업을 방해해선 안 됩니다.
command -v jq >/dev/null 2>&1 || exit 0

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty')
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty')
TOOL_INPUT=$(printf '%s' "$INPUT" | jq -c '.tool_input // {}')

[ -n "$SESSION_ID" ] || exit 0
[ -n "$TOOL_NAME" ] || exit 0

# 폴더 이름을 세션 이름으로 씁니다. 워치 화면이 좁아서 경로 전체는 안 들어갑니다.
SESSION_NAME=$(basename "${CWD:-맥 세션}")

PAYLOAD=$(jq -n \
  --arg sessionId "$SESSION_ID" \
  --arg sessionName "$SESSION_NAME" \
  --arg toolName "$TOOL_NAME" \
  --argjson toolInput "$TOOL_INPUT" \
  --argjson timeoutMs "$WAIT_MS" \
  '{sessionId:$sessionId, sessionName:$sessionName, toolName:$toolName, toolInput:$toolInput, timeoutMs:$timeoutMs}')

# max-time 은 브리지가 기다리는 시간보다 넉넉하게 잡습니다.
MAX_TIME=$(( WAIT_MS / 1000 + 15 ))

RESPONSE=$(printf '%s' "$PAYLOAD" | curl -s --max-time "$MAX_TIME" \
  -X POST "$BRIDGE/external/ask" \
  -H 'Content-Type: application/json' \
  --data-binary @- 2>/dev/null)

# 브리지가 안 떠 있거나 응답이 이상하면 결정 없이 빠집니다.
[ -n "$RESPONSE" ] || exit 0

DECISION=$(printf '%s' "$RESPONSE" | jq -r '.decision // "timeout"' 2>/dev/null)

case "$DECISION" in
  allow)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"allow", permissionDecisionReason:"애플워치에서 승인했습니다."}}'
    ;;
  deny)
    jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:"애플워치에서 거부했습니다."}}'
    ;;
  *)
    # timeout·오류 — 결정하지 않습니다. 터미널이 평소처럼 물어봅니다.
    exit 0
    ;;
esac
