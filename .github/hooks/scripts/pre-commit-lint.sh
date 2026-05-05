#!/usr/bin/env bash
# Pre-commit lint hook: blocks git commit if TypeScript type-check fails.
# Receives a PreToolUse JSON payload on stdin.
set -uo pipefail

INPUT=$(cat)

# Only intercept run_in_terminal calls
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
if [ "$TOOL_NAME" != "run_in_terminal" ]; then
  echo '{"continue": true}'
  exit 0
fi

# Only intercept git commit commands
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
if ! echo "$COMMAND" | grep -qE '(^|[;&|])\s*git\s+commit'; then
  echo '{"continue": true}'
  exit 0
fi

# Run TypeScript type-check (no emit)
TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  REASON="TypeScript errors must be fixed before committing."
  MESSAGE=$(printf "TypeScript errors found — fix before committing:\n\n%s" "$TSC_OUTPUT")
  jq -n \
    --arg reason "$REASON" \
    --arg msg "$MESSAGE" \
    '{
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: $reason
      },
      systemMessage: $msg
    }'
  exit 0
fi

echo '{"continue": true}'
