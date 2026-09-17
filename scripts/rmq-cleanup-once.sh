#!/usr/bin/env bash
# rmq-cleanup-once.sh — one-time removal of leaked test queues (no log file, stdout only).
# Uses rabbitmqd kits only via sudo: rabbitmqctl delete_queue (queues) +
# rabbitmqctl eval rabbit_exchange:delete (exchanges — rabbitmqctl has no
# delete_exchange and the management plugin / rabbitmqadmin is unavailable here).
# Args-agnostic: server-side delete takes only the name, so both
#   legacy rmq-int-*.tui.* (no args) and latest tui.<ns>.s1 (x-max-length/overflow/ttl) delete identically.
# Keeps prod: tui.s1/s2/s2direct/s3s4 on jobs.events.
# --purge-prod: drain the 4 fixed prod queues to rerun (close TUI consumer
# connections so unacked requeues to ready, then purge_queue x4, verify 0/0).
# purge_queue alone cannot touch unacked — this flag exists because of that.
# Usage: sudo ./scripts/rmq-cleanup-once.sh [--dry-run] [--purge-prod]
set -uo pipefail

DRY_RUN=0
PURGE_PROD=0
for a in "$@"; do
  case "$a" in
    --dry-run|-n) DRY_RUN=1 ;;
    --purge-prod) PURGE_PROD=1 ;;
    --help|-h)
      echo "usage: sudo ./scripts/rmq-cleanup-once.sh [--dry-run] [--purge-prod]"
      exit 0
      ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

is_prod_queue() {
  case "$1" in
    tui.s1|tui.s2|tui.s2direct|tui.s3s4) return 0 ;;
    *) return 1 ;;
  esac
}

is_test_queue() {
  local q="$1"
  if is_prod_queue "$q"; then return 1; fi
  # legacy: rmq-int-<ts>.tui.(s1|s2|s2direct|s3s4)
  if [[ "$q" =~ ^rmq-int-.*\.tui\.(s1|s2|s2direct|s3s4)$ ]]; then return 0; fi
  # latest: tui.<ns>.(s1|s2|s2direct|s3s4) — ns non-empty, so prod 4 already excluded above
  if [[ "$q" =~ ^tui\..+\.(s1|s2|s2direct|s3s4)$ ]]; then return 0; fi
  # old facade ephemeral consumers: tui.<ns>.consume.(s1|s2|s34|s3s4) — purge-only helper never deleted them
  if [[ "$q" =~ ^tui\..+\.consume\.(s1|s2|s34|s3s4)$ ]]; then return 0; fi
  # deleted tui-mode-switching suite: tui-mode-<ts>.(s1|s2|s3s4) + defensive consume variant
  if [[ "$q" =~ ^tui-mode-.*\.(s1|s2|s3s4)$ ]]; then return 0; fi
  if [[ "$q" =~ ^tui-mode-.*\.consume\.(s1|s2|s34)$ ]]; then return 0; fi
  # historical timestamped suites (rmq-ingestor-<ts>, c4-direct-<ts>, c1-canonical-<ts>, …):
  # generic -178<epoch-ms> + stage suffix. Prod names never contain timestamps.
  if [[ "$q" =~ ^[a-z0-9][a-z0-9-]*-178[0-9]{10,}\.(s1|s2|s2direct|s3s4|s34|catch)$ ]]; then return 0; fi
  # historical debug runs: dbg-*, dbg-catch-<ts> (no suffix), dbg-c4*-<ts>.s2
  if [[ "$q" =~ ^dbg(-.*)?$ ]]; then return 0; fi
  return 1
}

is_test_exchange() {
  if [[ "$1" =~ ^jobs\.events\.int\..+$ ]]; then return 0; fi
  # deleted tui-mode-switching suite private broker
  if [[ "$1" =~ ^jobs\.events\.tui\.itest\..+$ ]]; then return 0; fi
  return 1
}

echo "[rmq-cleanup] listing queues (sudo rabbitmqctl)..."
QUEUES="$(sudo rabbitmqctl list_queues name --quiet 2>/dev/null)"
if [[ -z "$QUEUES" ]]; then
  echo "[rmq-cleanup] FAIL: empty queue list (rabbitmqctl needs sudo; run with sudo)" >&2
  exit 1
fi

echo "[rmq-cleanup] listing exchanges (sudo rabbitmqctl)..."
EXCHANGES="$(sudo rabbitmqctl list_exchanges name --quiet 2>/dev/null || true)"

TARGETS=()
KEPT_PROD=0
SKIPPED=0
while IFS= read -r q; do
  [[ -z "$q" ]] && continue
  if is_prod_queue "$q"; then
    KEPT_PROD=$((KEPT_PROD + 1))
  elif is_test_queue "$q"; then
    TARGETS+=("$q")
  else
    SKIPPED=$((SKIPPED + 1))
  fi
done <<< "$QUEUES"

TEST_EXCHANGES=()
while IFS= read -r ex; do
  [[ -z "$ex" ]] && continue
  if is_test_exchange "$ex"; then
    TEST_EXCHANGES+=("$ex")
  fi
done <<< "$EXCHANGES"

echo "[rmq-cleanup] prod kept: $KEPT_PROD, test queue targets: ${#TARGETS[@]}, test exchanges: ${#TEST_EXCHANGES[@]}, skipped(other): $SKIPPED"
if [[ "$DRY_RUN" -eq 1 ]]; then
  for q in ${TARGETS[@]+"${TARGETS[@]}"}; do echo "DELETE queue $q"; done
  for ex in ${TEST_EXCHANGES[@]+"${TEST_EXCHANGES[@]}"}; do echo "DELETE exchange $ex"; done
  echo "[rmq-cleanup] dry-run done (no changes)."
  exit 0
fi

DELETED=0
FAILED=0
for q in ${TARGETS[@]+"${TARGETS[@]}"}; do
  if sudo rabbitmqctl delete_queue "$q" >/dev/null 2>&1; then
    echo "deleted queue $q"
    DELETED=$((DELETED + 1))
  else
    echo "FAILED queue $q (already gone? continuing)" >&2
    FAILED=$((FAILED + 1))
  fi
done

# Server-side exchange delete via rabbitmqctl eval.
# Proven live on rabbitmq-server 3.9.27: only rabbit_exchange:delete/3 exists
# (delete/1 and delete/2 both return undef). Names are broker-generated
# ([A-Za-z0-9._-]) — reject anything quotable before embedding in Erlang.
delete_exchange_eval() {
  local ex="$1"
  if [[ "$ex" == *'"'* || "$ex" == *'\'* ]]; then return 1; fi
  local expr="rabbit_exchange:delete({resource, <<\"/\">>, exchange, <<\"${ex}\">>}, false, <<\"rmq-cleanup\">>)."
  local out
  if out=$(sudo rabbitmqctl eval "$expr" 2>&1); then
    return 0
  fi
  echo "$out" >&2
  return 1
}

EX_DELETED=0
EX_FAILED=0
for ex in ${TEST_EXCHANGES[@]+"${TEST_EXCHANGES[@]}"}; do
  if delete_exchange_eval "$ex" >/dev/null 2>&1; then
    echo "deleted exchange $ex"
    EX_DELETED=$((EX_DELETED + 1))
  else
    echo "FAILED exchange $ex (continuing)" >&2
    EX_FAILED=$((EX_FAILED + 1))
  fi
done

echo "[rmq-cleanup] done: queues deleted=$DELETED failed=$FAILED, exchanges deleted=$EX_DELETED failed=$EX_FAILED"
echo "[rmq-cleanup] verify (stdout only, no log file):"
sudo rabbitmqctl list_queues name --quiet 2>/dev/null | grep -E 'rmq-int-|^tui\..+\.s|^tui-mode-|-178[0-9]{10,}\.|^dbg-' || echo "[rmq-cleanup] verify ok: no test queues remain"

# --purge-prod: drain the 4 fixed prod queues so a tmux rerun starts empty.
# purge_queue only discards ready; unacked must first be freed by closing the
# consumer connections (server requeues unacked to ready on channel close).
# Correlate strictly via broker pids: consumer channel_pid -> channel pid ->
# connection name. Refuse (no close, no purge) when correlation yields nothing.
if [[ "$PURGE_PROD" -eq 1 ]]; then
  echo "[rmq-cleanup] --purge-prod: snapshotting prod 4 (ready/unacked)..."
  BEFORE="$(sudo rabbitmqctl list_queues name messages_ready messages_unacknowledged --quiet 2>/dev/null | grep -E '^tui\.(s1|s2|s2direct|s3s4)[[:space:]]' || true)"
  echo "$BEFORE" | sed 's/^/[rmq-cleanup] before: /'
  if [[ -z "$BEFORE" ]]; then
    echo "[rmq-cleanup] FAIL: prod 4 not listed (rabbitmqctl needs sudo; run with sudo)" >&2
    exit 1
  fi

  echo "[rmq-cleanup] --purge-prod: correlating prod consumers -> connections..."
  CONSUMERS="$(sudo rabbitmqctl list_consumers queue_name channel_pid --quiet 2>/dev/null || true)"
  CHANNELS="$(sudo rabbitmqctl list_channels pid connection consumer_count --quiet 2>/dev/null || true)"
  CONNS=()
  PROD_CONSUMERS=0
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    q="${line%%[[:space:]]*}"
    pid="${line##*[[:space:]]}"
    case "$q" in
      tui.s1|tui.s2|tui.s2direct|tui.s3s4) ;;
      *) continue ;;
    esac
    PROD_CONSUMERS=$((PROD_CONSUMERS + 1))
    conn="$(echo "$CHANNELS" | awk -v p="$pid" '$1==p { $1=""; sub(/^ +/, ""); print }' | awk '{ NF--; print }' | sed 's/ [0-9][0-9]*$//' || true)"
    # channel row: "<pid> <connection...> <consumer_count>" — connection may
    # contain spaces ("ip:port -> ip:port"); strip only the trailing count.
    [[ -z "$conn" ]] && continue
    CONNS+=("$conn")
  done <<< "$CONSUMERS"
  # dedupe, preserving order
  UNIQUE=()
  for c in ${CONNS[@]+"${CONNS[@]}"}; do
    skip=0
    for u in ${UNIQUE[@]+"${UNIQUE[@]}"}; do [[ "$u" == "$c" ]] && skip=1; done
    [[ "$skip" -eq 0 ]] && UNIQUE+=("$c")
  done
  echo "[rmq-cleanup] --purge-prod: prod consumers: $PROD_CONSUMERS, connections: ${#UNIQUE[@]}"
  if [[ "$PROD_CONSUMERS" -gt 0 && "${#UNIQUE[@]}" -eq 0 ]]; then
    echo "[rmq-cleanup] FAIL: consumers exist but pid->connection correlation failed (check list_channels pid support) — refusing purge" >&2
    exit 1
  fi
  if [[ "${#UNIQUE[@]}" -eq 0 ]]; then
    echo "[rmq-cleanup] --purge-prod: no consumers on prod 4 (already free) — purging directly."
  elif [[ "$DRY_RUN" -eq 1 ]]; then
    for c in ${UNIQUE[@]+"${UNIQUE[@]}"}; do echo "CLOSE connection $c"; done
    for q in tui.s1 tui.s2 tui.s2direct tui.s3s4; do echo "PURGE queue $q"; done
    echo "[rmq-cleanup] dry-run done (no changes)."
    exit 0
  else
    for c in ${UNIQUE[@]+"${UNIQUE[@]}"}; do
      echo "[rmq-cleanup] closing consumer connection: $c"
      if ! sudo rabbitmqctl close_connection "$c" "rmq-cleanup --purge-prod" 2>&1 | tail -1; then
        echo "[rmq-cleanup] FAIL: close_connection failed — refusing purge (rerun cleanup after stopping TUI)" >&2
        exit 1
      fi
    done
    sleep 3
    UNACKED="$(sudo rabbitmqctl list_queues name messages_ready messages_unacknowledged --quiet 2>/dev/null | grep -E '^tui\.(s1|s2|s2direct|s3s4)[[:space:]]' | awk '{u+=$3} END {print u+0}')"
    echo "[rmq-cleanup] --purge-prod: unacked after close: $UNACKED"
    if [[ "$UNACKED" != "0" ]]; then
      echo "[rmq-cleanup] FAIL: unacked still held (consumers elsewhere?) — refusing purge" >&2
      exit 1
    fi
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    for q in tui.s1 tui.s2 tui.s2direct tui.s3s4; do echo "PURGE queue $q"; done
    echo "[rmq-cleanup] dry-run done (no changes)."
    exit 0
  fi
  for q in tui.s1 tui.s2 tui.s2direct tui.s3s4; do
    echo "[rmq-cleanup] purging $q"
    sudo rabbitmqctl purge_queue "$q" 2>&1 | tail -1
  done
  echo "[rmq-cleanup] --purge-prod: after:"
  sudo rabbitmqctl list_queues name messages_ready messages_unacknowledged --quiet 2>/dev/null | grep -E '^tui\.(s1|s2|s2direct|s3s4)[[:space:]]' | sed 's/^/[rmq-cleanup] after: /'
fi
