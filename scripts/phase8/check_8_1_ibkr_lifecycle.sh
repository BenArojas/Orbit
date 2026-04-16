#!/usr/bin/env bash
# Phase 8.1 — IBKR Connection Lifecycle helper
#
# Usage:
#   ./check_8_1_ibkr_lifecycle.sh            # runs all probes
#   ./check_8_1_ibkr_lifecycle.sh status     # one-shot status dump
#   ./check_8_1_ibkr_lifecycle.sh poll       # poll /gateway/status every 2s
#   ./check_8_1_ibkr_lifecycle.sh drop       # watch for session_dropped
#
# Prereqs:
#   - Backend running (uvicorn main:app --port 8000)
#   - IBKR Gateway running on https://localhost:5001 and authenticated
#
# What this does NOT do:
#   - Does not kill the gateway for you (you do that manually)
#   - Does not trigger the auto-reconnect flow (that is a browser action)
#
# Exit code 0 if all assertions pass.

set -u

BACKEND="${BACKEND:-http://localhost:8000}"
GATEWAY="${GATEWAY:-https://localhost:5001}"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
red()   { printf '\033[31m%s\033[0m\n' "$*"; }
amber() { printf '\033[33m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

status_json() {
  curl -sS --max-time 5 "$BACKEND/gateway/status"
}

assert_key() {
  # $1 = json, $2 = jq path, $3 = expected
  local got
  got=$(printf '%s' "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$2)" 2>/dev/null)
  if [ "$got" = "$3" ]; then
    green "  ✓ $2 == $3"
    return 0
  else
    red   "  ✗ $2 == $3  (got: $got)"
    return 1
  fi
}

case "${1:-all}" in
  status)
    bold "[one-shot] GET $BACKEND/gateway/status"
    status_json | python3 -m json.tool
    ;;

  poll)
    bold "[poll] every 2s — Ctrl-C to stop"
    while true; do
      ts=$(date +%H:%M:%S)
      j=$(status_json)
      running=$(printf '%s' "$j" | python3 -c "import sys,json; print(json.load(sys.stdin).get('running'))" 2>/dev/null)
      authed=$(printf  '%s' "$j" | python3 -c "import sys,json; print(json.load(sys.stdin).get('authenticated'))" 2>/dev/null)
      dropped=$(printf '%s' "$j" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_dropped'))" 2>/dev/null)
      printf '%s  running=%-5s  auth=%-5s  dropped=%-5s\n' "$ts" "$running" "$authed" "$dropped"
      sleep 2
    done
    ;;

  drop)
    bold "[drop-watch] polls until session_dropped flips to True"
    amber "Kill the gateway now to simulate mid-session drop."
    while true; do
      j=$(status_json)
      dropped=$(printf '%s' "$j" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_dropped'))" 2>/dev/null)
      if [ "$dropped" = "True" ]; then
        green "✓ session_dropped flipped to True — expected re-auth banner in UI now"
        exit 0
      fi
      sleep 2
    done
    ;;

  all|*)
    bold "=== 8.1 IBKR lifecycle assertions ==="
    fails=0

    bold "[step A] Backend health"
    if curl -sS --max-time 3 "$BACKEND/health" >/dev/null; then
      green "  ✓ backend reachable"
    else
      red "  ✗ backend NOT reachable at $BACKEND"
      exit 1
    fi

    bold "[step B] Gateway running + authed (baseline)"
    j=$(status_json)
    assert_key "$j" "['running']"         "True"         || fails=$((fails+1))
    assert_key "$j" "['authenticated']"   "True"         || fails=$((fails+1))
    assert_key "$j" "['session_dropped']" "False"        || fails=$((fails+1))

    bold "[step C] Required fields present in /gateway/status"
    for k in running authenticated auth_required auth_message session_dropped; do
      if printf '%s' "$j" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$k' in d else 1)"; then
        green "  ✓ field '$k' present"
      else
        red "  ✗ field '$k' missing"
        fails=$((fails+1))
      fi
    done

    bold "[step D] Gateway reachable directly"
    if curl -sSk --max-time 3 "$GATEWAY" >/dev/null; then
      green "  ✓ gateway reachable at $GATEWAY"
    else
      red "  ✗ gateway NOT reachable at $GATEWAY"
      fails=$((fails+1))
    fi

    echo
    if [ "$fails" -eq 0 ]; then
      green "All automated assertions passed. Now run the manual steps (see phase8-checklist-8.1.md)."
      exit 0
    else
      red "$fails assertion(s) failed. See phase8-checklist-8.1.md before continuing."
      exit 1
    fi
    ;;
esac
