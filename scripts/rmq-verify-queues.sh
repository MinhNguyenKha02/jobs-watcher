#!/usr/bin/env bash
# rmq-verify-queues.sh — read-only broker verification (no log file, stdout only).
# Uses rabbitmqd kits only: sudo rabbitmqctl list_queues / list_exchanges.
# Prints per-queue status details (ready/unacked/consumers) for prod 4
# (and tui.<ns> 4 with --ns), then fail-strict verdicts.
# Fail-strict: any queue beyond the fixed prod 4 (or, with --ns, beyond prod 4
# + tui.<ns> 4) or any test exchange fails with the offenders listed.
# Matchers mirror scripts/rmq-cleanup-once.sh so verify and cleanup agree.
#
# Usage:
#   sudo ./scripts/rmq-verify-queues.sh                # steady-state: exact prod 4, no test exchanges (+ details)
#   sudo ./scripts/rmq-verify-queues.sh --expect-empty # rerun gate: prod 4 exist AND 0 ready/0 unacked
#   sudo ./scripts/rmq-verify-queues.sh --ns <ns>      # in-suite: prod 4 + tui.<ns> 4 + jobs.events.int.<ns>
set -uo pipefail

NS=""
EXPECT_EMPTY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      echo "usage: sudo ./scripts/rmq-verify-queues.sh [--expect-empty] [--ns <name>]"
      exit 0
      ;;
    --expect-empty) EXPECT_EMPTY=1; shift ;;
    --ns)
      NS="${2:?--ns requires a namespace argument}"
      shift 2
      ;;
    --ns=*)
      NS="${1#--ns=}"
      shift
      ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

is_prod_queue() {
  case "$1" in
    tui.s1|tui.s2|tui.s2direct|tui.s3s4) return 0 ;;
    *) return 1 ;;
  esac
}

is_expected_ns_queue() {
  [[ -n "$NS" && "$1" =~ ^tui\.${NS}\.(s1|s2|s2direct|s3s4)$ ]]
}

is_test_exchange() {
  if [[ "$1" =~ ^jobs\.events\.int\..+$ ]]; then return 0; fi
  if [[ "$1" =~ ^jobs\.events\.tui\.itest\..+$ ]]; then return 0; fi
  return 1
}

echo "[rmq-verify] listing queues (sudo rabbitmqctl)..."
QUEUES="$(sudo rabbitmqctl list_queues name messages_ready messages_unacknowledged consumers --quiet 2>/dev/null)"
if [[ -z "$QUEUES" ]]; then
  echo "[rmq-verify] FAIL: empty queue list (rabbitmqctl needs sudo; run with sudo)" >&2
  exit 1
fi

echo "[rmq-verify] listing exchanges (sudo rabbitmqctl)..."
EXCHANGES="$(sudo rabbitmqctl list_exchanges name --quiet 2>/dev/null || true)"

PROD=0
EXPECTED_NS=0
OFFENDING_QUEUES=()
declare -A QDETAIL=() # name -> "ready unacked consumers"
while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  # columns: name ready unacked consumers (queue names never contain spaces)
  q="${row%%[[:space:]]*}"
  [[ "$q" == "name" ]] && continue # rabbitmqctl header row (with or without --quiet)
  rest="$(echo "$row" | awk '{print $(NF-2), $(NF-1), $NF}')"
  if is_prod_queue "$q"; then
    PROD=$((PROD + 1))
    QDETAIL["$q"]="$rest"
  elif is_expected_ns_queue "$q"; then
    EXPECTED_NS=$((EXPECTED_NS + 1))
    QDETAIL["$q"]="$rest"
  else
    OFFENDING_QUEUES+=("$row")
  fi
done <<< "$QUEUES"

EXPECTED_EX=""
OFFENDING_EXCHANGES=()
while IFS= read -r ex; do
  [[ -z "$ex" ]] && continue
  [[ "${ex%%[[:space:]]*}" == "name" ]] && continue # rabbitmqctl header row
  if [[ -n "$NS" && "$ex" == "jobs.events.int.${NS}" ]]; then
    EXPECTED_EX="$ex"
  elif is_test_exchange "$ex"; then
    OFFENDING_EXCHANGES+=("$ex")
  fi
done <<< "$EXCHANGES"

FAIL=0
if [[ -n "$NS" ]]; then
  echo "[rmq-verify] mode=in-suite ns=${NS} prod=${PROD}/4 expected_ns=${EXPECTED_NS}/4"
  [[ "$PROD" -ne 4 ]] && { echo "[rmq-verify] FAIL: prod queues != 4" >&2; FAIL=1; }
  [[ "$EXPECTED_NS" -ne 4 ]] && { echo "[rmq-verify] FAIL: tui.${NS} queues != 4" >&2; FAIL=1; }
  [[ -z "$EXPECTED_EX" ]] && { echo "[rmq-verify] FAIL: missing exchange jobs.events.int.${NS}" >&2; FAIL=1; }
elif [[ "$EXPECT_EMPTY" -eq 1 ]]; then
  echo "[rmq-verify] mode=expect-empty prod=${PROD}/4 (rerun gate: 0 ready/0 unacked)"
  [[ "$PROD" -ne 4 ]] && { echo "[rmq-verify] FAIL: prod queues != 4" >&2; FAIL=1; }
else
  echo "[rmq-verify] mode=steady-state prod=${PROD}/4"
  [[ "$PROD" -ne 4 ]] && { echo "[rmq-verify] FAIL: prod queues != 4" >&2; FAIL=1; }
fi

# status details: prod 4 (+ ns 4) ready/unacked/consumers, fixed order
echo "[rmq-verify] status: queue ready unacked consumers"
for q in tui.s1 tui.s2 tui.s2direct tui.s3s4; do
  if [[ -n "${QDETAIL[$q]:-}" ]]; then
    echo "[rmq-verify] status: $q ${QDETAIL[$q]}"
  else
    echo "[rmq-verify] status: $q MISSING"
  fi
done
if [[ -n "$NS" ]]; then
  for q in "tui.${NS}.s1" "tui.${NS}.s2" "tui.${NS}.s2direct" "tui.${NS}.s3s4"; do
    if [[ -n "${QDETAIL[$q]:-}" ]]; then
      echo "[rmq-verify] status: $q ${QDETAIL[$q]}"
    else
      echo "[rmq-verify] status: $q MISSING"
    fi
  done
fi

# rerun gate: every tracked queue must be fully drained
if [[ "$EXPECT_EMPTY" -eq 1 ]]; then
  for q in "${!QDETAIL[@]}"; do
    set -- ${QDETAIL[$q]}
    if [[ "${1:-0}" != "0" || "${2:-0}" != "0" ]]; then
      echo "[rmq-verify] FAIL: $q not empty (ready=${1:-?} unacked=${2:-?}) — run cleanup --purge-prod first" >&2
      FAIL=1
    fi
  done
fi

for q in ${OFFENDING_QUEUES[@]+"${OFFENDING_QUEUES[@]}"}; do
  echo "OFFENDER queue $q"
  FAIL=1
done
for ex in ${OFFENDING_EXCHANGES[@]+"${OFFENDING_EXCHANGES[@]}"}; do
  echo "OFFENDER exchange $ex"
  FAIL=1
done

if [[ "$FAIL" -eq 0 ]]; then
  echo "[rmq-verify] OK: green"
else
  echo "[rmq-verify] FAIL: ${#OFFENDING_QUEUES[@]} offending queue(s), ${#OFFENDING_EXCHANGES[@]} offending exchange(s)" >&2
fi
exit "$FAIL"
