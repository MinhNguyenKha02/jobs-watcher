# Interview Simulation Script Setup

## Quick Start

```bash
# Make script executable
chmod +x interview-simulation.sh

# Run with default settings (2 min per question, interview-questions.txt)
./interview-simulation.sh

# Run with custom settings
./interview-simulation.sh my-questions.txt 3  # 3 minutes per question
```

## Features

- ⏱️ **Real-time countdown timer** for each question
- 📝 **Automatic logging** to timestamped log files
- 🔄 **Loop mode** to answer multiple questions
- 📊 **Session summary** with question count and log location
- 🔧 **Customizable** time limits and question files

## Daily Cron Setup

To run the interview simulation daily at 10 AM:

```bash
# Edit your crontab
crontab -e

# Add this line (runs at 10:00 AM every day):
0 10 * * * cd /home/minh-nguyen/node_projects/jobs-watcher/bored-cv-refinement/portfolio/a-interview && ./interview-simulation.sh >> ./cron-runs.log 2>&1
```

### Cron Examples

| Time | Cron Expression |
|------|-----------------|
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

```
interview-simulation.sh      # Main script
interview-questions.txt      # Question bank
interview-logs/              # Auto-created logs directory
  - YYYY-MM-DD_HH-MM-SS.log # Session logs
```

## Customization

### Change Question File
Edit `interview-questions.txt` or pass a custom file:
```bash
./interview-simulation.sh my-custom-questions.txt
```

### Change Timer Duration
```bash
./interview-simulation.sh interview-questions.txt 5  # 5 minutes per question
```

### Auto-Run with Cron + Email Notification
```bash
0 10 * * * cd /path/to/script && ./interview-simulation.sh && \
  echo "Interview session complete. Check logs." | mail -s "Daily Interview Done" your@email.com
```

## Notes

- Logs are stored in `interview-logs/` with unique timestamps
- Press Ctrl+C to interrupt a timer
- Session ends gracefully after all questions or when user chooses 'n'
