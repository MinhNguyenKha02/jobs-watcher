# Interview Simulation Script Setup

## Quick Start

```bash
# Make script executable
chmod +x 05-scripts/interview-simulation.sh

# Run with default settings
# - Questions: 02-questions/interview-questions.txt
# - Time: 2 minutes per question
# - Expected keywords: 02-questions/expected-keywords.txt
./05-scripts/interview-simulation.sh

# Run with custom settings
./05-scripts/interview-simulation.sh ./02-questions/interview-questions.txt 3

# Optional 3rd argument: custom expected keywords file
./05-scripts/interview-simulation.sh ./02-questions/interview-questions.txt 3 ./02-questions/my-expected-keywords.txt
```

## Features

- ⏱️ **Timed input loop** for each question (type `DONE` to finish early)
- 📝 **Automatic snapshot capture** per question when answer input ends
- 📌 **Expected keyword matching** against your answer
- 📊 **Evaluation prompts** aligned to RESPONSE-EVALUATION-FRAMEWORK dimensions
- 🗂️ **Session logs + markdown snapshots** in `06-outputs/`
- 🔄 **Loop mode** to answer multiple questions
- 📊 **Session summary** with question count and output locations
- 🔧 **Customizable** question files, time limits, and expected-keyword files

## During Answer Input

For each question:

1. Start typing your answer in multiple lines
2. Type `DONE` on a new line to submit early
3. If timer expires, current answer is captured automatically
4. Script asks for quick 0-3 evaluation scores
5. Snapshot markdown file is saved immediately

## Daily Cron Setup

To run the interview simulation daily at 10 AM:

```bash
# Edit your crontab
crontab -e

# Add this line (runs at 10:00 AM every day):
0 10 * * * cd /home/minh-nguyen/node_projects/jobs-watcher/bored-cv-refinement/portfolio/a-interview && ./05-scripts/interview-simulation.sh >> ./cron-runs.log 2>&1
```

### Cron Examples

| Time | Cron Expression |
| ---- | --------------- |
| 10 AM daily | `0 10 * * *` |
| 2 PM daily | `0 14 * * *` |
| 9 AM weekdays | `0 9 * * 1-5` |
| Midnight daily | `0 0 * * *` |

### View Cron Logs

```bash
# See all scheduled jobs
crontab -l

# View job history
tail -f ./cron-runs.log
```

## Files Structure

```text
05-scripts/interview-simulation.sh
02-questions/interview-questions.txt
02-questions/expected-keywords.txt
06-outputs/
  ├── loop-logs/
  │   └── interview-simulation-YYYY-MM-DD_HH-MM-SS.log
  └── loop-snapshots/
      └── YYYY-MM-DD_HH-MM-SS/
          ├── q01-snapshot.md
          ├── q02-snapshot.md
          └── session-summary.md
```

### Expected Keywords Format

`expected-keywords.txt` uses one line per question:

```text
# Format: question_number|comma,separated,keywords
1|validation,service,persistence,external,failure
2|root cause,log,error reproduction
3|context,trade-off,next steps
```

If the file does not exist, the script auto-creates a template.

## Customization

### Change Question File

Edit `interview-questions.txt` or pass a custom file:

```bash
./05-scripts/interview-simulation.sh my-custom-questions.txt
```

### Change Timer Duration

```bash
./05-scripts/interview-simulation.sh interview-questions.txt 5
```

### Use a Custom Expected Keywords File

```bash
./05-scripts/interview-simulation.sh interview-questions.txt 5 ./my-expected-keywords.txt
```

### Auto-Run with Cron + Email Notification

```bash
0 10 * * * cd /path/to/script && ./interview-simulation.sh && \
  echo "Interview session complete. Check logs." | mail -s "Daily Interview Done" your@email.com
```

## Notes

- Logs and snapshots are stored in `06-outputs/` with session timestamps
- Answer entry ends by typing `DONE` or when timer expires
- Session ends gracefully after all questions or when user chooses `n`
