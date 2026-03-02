#!/bin/bash

# Interview Simulation Script with Timer
# Usage: ./interview-simulation.sh [questions_file] [time_limit_minutes]
# Logs results to: ./interview-logs/$(date +%Y-%m-%d_%H-%M-%S).log

set -e

# Configuration
QUESTIONS_FILE="${1:-interview-questions.txt}"
TIME_LIMIT=${2:-2}
LOG_DIR="./interview-logs"
LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d_%H-%M-%S).log"

# Ensure directories and files exist
mkdir -p "$LOG_DIR"
[[ -f "$QUESTIONS_FILE" ]] || {
    echo "Error: $QUESTIONS_FILE not found. Creating template..."
    cat > "$QUESTIONS_FILE" << 'EOF'
Tell me about a challenging project you worked on.
How do you approach debugging a complex issue?
Describe a time you had to learn something new quickly.
What's your approach to writing maintainable code?
How do you handle disagreements with team members?
EOF
    echo "Template created. Edit $QUESTIONS_FILE and run again."
    exit 0
}

# Helper function: Run a countdown timer
timer() {
    local seconds=$((TIME_LIMIT * 60))
    while ((seconds > 0)); do
        printf "\r⏱️  Time remaining: %02d:%02d" $((seconds / 60)) $((seconds % 60))
        sleep 1
        ((seconds--))
    done
    echo -e "\n⏰ Time's up!"
}

# Header
{
    echo "=== Interview Simulation Session ==="
    echo "Date: $(date)"
    echo "Time Limit per Question: $TIME_LIMIT minutes"
    echo "========================================"
    echo
} | tee "$LOG_FILE"

# Main loop
question_num=0
while IFS= read -r question || [[ -n "$question" ]]; do
    [[ -z "$question" ]] && continue
    ((question_num++))

    echo
    echo "--- Question $question_num ---"
    echo "$question"
    echo

    # Start timer in background
    timer &
    TIMER_PID=$!

    # Get user answer
    read -p "Your answer: " answer

    # Terminate timer if still running
    kill $TIMER_PID 2>/dev/null || true
    wait $TIMER_PID 2>/dev/null || true

    # Log the answer with timestamp
    {
        echo "Q$question_num: $question"
        echo "Time: $(date +%H:%M:%S)"
        echo "Answer: $answer"
        echo
    } | tee -a "$LOG_FILE"

    # Ask if user wants to continue
    echo -n "Continue? (y/n): "
    read -r continue
    [[ "$continue" != "y" && "$continue" != "Y" ]] && break

done < "$QUESTIONS_FILE"

# Summary
{
    echo "=== Session Complete ==="
    echo "End Time: $(date)"
    echo "Questions Answered: $question_num"
    echo "Log saved to: $LOG_FILE"
} | tee -a "$LOG_FILE"
