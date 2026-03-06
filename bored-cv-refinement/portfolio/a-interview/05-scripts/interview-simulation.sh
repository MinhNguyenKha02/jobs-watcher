#!/bin/bash

# Timed one-by-one QA input
# Usage: ./interview-simulation.sh [questions_file] [time_limit_minutes]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

QUESTIONS_FILE="${1:-$ROOT_DIR/02-questions/interview-questions.txt}"
TIME_LIMIT_MINUTES="${2:-2}"

SESSION_ID="$(date +%Y-%m-%d_%H-%M-%S)"
OUTPUT_DIR="$ROOT_DIR/06-outputs"
LOG_DIR="$OUTPUT_DIR/loop-logs"
SNAPSHOT_DIR="$OUTPUT_DIR/loop-snapshots/$SESSION_ID"
LOG_FILE="$LOG_DIR/interview-simulation-$SESSION_ID.log"

mkdir -p "$LOG_DIR" "$SNAPSHOT_DIR"

if ! [[ "$TIME_LIMIT_MINUTES" =~ ^[0-9]+$ ]] || ((TIME_LIMIT_MINUTES <= 0)); then
    echo "Error: time_limit_minutes must be a positive integer."
    echo "Usage: ./interview-simulation.sh [questions_file] [time_limit_minutes]"
    exit 1
fi

if [[ ! -f "$QUESTIONS_FILE" ]]; then
    echo "Error: Questions file not found: $QUESTIONS_FILE"
    exit 1
fi

# Proc 1: timer + input collection
collect_timed_answer() {
    local total_seconds=$1
    local end_ts=$(( $(date +%s) + total_seconds ))
    local timed_out=0
    local line=""
    local -a lines=()

    echo "Type your answer line by line. Enter DONE to finish."

    while true; do
        local now
        now=$(date +%s)
        local remaining=$(( end_ts - now ))

        if ((remaining <= 0)); then
            timed_out=1
            break
        fi

        printf "\r⏱️  Remaining: %02d:%02d" $((remaining / 60)) $((remaining % 60))

        if IFS= read -r -t 1 line; then
            if [[ "$line" == "DONE" ]]; then
                break
            fi
            lines+=("$line")
        fi
    done

    echo

    local answer_text=""
    if ((${#lines[@]} > 0)); then
        answer_text=$(printf "%s\n" "${lines[@]}")
    fi

    printf "%s\n<STATE>%s\n" "$answer_text" "$timed_out"
}

# Proc 2: log QA state
log_qa_snapshot() {
    local q_num=$1
    local question=$2
    local answer=$3
    local elapsed=$4
    local state=$5
    local snapshot_file
    snapshot_file="$SNAPSHOT_DIR/q$(printf "%02d" "$q_num")-snapshot.md"

    {
        echo "# Q$q_num"
        echo
        echo "- Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
        echo "- State: $state"
        echo "- Elapsed (seconds): $elapsed"
        echo
        echo "## Question"
        echo "$question"
        echo
        echo "## Answer"
        echo '```text'
        echo "$answer"
        echo '```'
    } > "$snapshot_file"

    {
        echo "Q$q_num | state=$state | elapsed=${elapsed}s"
        echo "Question: $question"
        echo "Snapshot: $snapshot_file"
        echo
    } | tee -a "$LOG_FILE"
}

{
    echo "=== Interview Simulation Session ==="
    echo "Date: $(date)"
    echo "Questions File: $QUESTIONS_FILE"
    echo "Time Limit per Question: ${TIME_LIMIT_MINUTES} minute(s)"
    echo "Session ID: $SESSION_ID"
    echo "==================================="
    echo
} | tee "$LOG_FILE"

time_limit_seconds=$((TIME_LIMIT_MINUTES * 60))
question_num=0

while IFS= read -r question || [[ -n "$question" ]]; do
    [[ -z "${question// }" ]] && continue
    ((question_num += 1))

    echo
    echo "--- Question $question_num ---"
    echo "$question"
    echo

    started_at=$(date +%s)
    collected=$(collect_timed_answer "$time_limit_seconds")
    timed_out=$(echo "$collected" | tail -n 1 | sed 's/<STATE>//')
    answer=$(echo "$collected" | sed '$d')
    ended_at=$(date +%s)
    elapsed=$((ended_at - started_at))

    state="completed"
    [[ "$timed_out" == "1" ]] && state="timed_out"

    log_qa_snapshot "$question_num" "$question" "$answer" "$elapsed" "$state"

    read -r -p "Continue to next question? (y/n): " continue_choice
    [[ "$continue_choice" != "y" && "$continue_choice" != "Y" ]] && break
done < "$QUESTIONS_FILE"

{
    echo "=== Session Complete ==="
    echo "Questions Answered: $question_num"
    echo "Log saved to: $LOG_FILE"
    echo "Snapshots saved to: $SNAPSHOT_DIR"
} | tee -a "$LOG_FILE"
