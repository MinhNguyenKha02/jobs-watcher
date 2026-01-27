# Jobs Watcher

**Automated job application materials from Gmail alerts.**

Listen to Gmail job alerts → Extract requirements → Match your profile → Generate CV/cover letter → Track everything locally.

## Features

- 📧 **Gmail Watch** - Automatic Pub/Sub webhook listener
- 🧠 **Smart Matching** - Extracts job requirements, matches with your profile, calculates score
- 📝 **Auto-Generated** - CV, resume, cover letter (LaTeX/Markdown) customized per job
- 💻 **TUI Interface** - Interactive popup (dev) or system notifications (production)
- 📊 **Local Monitoring** - JSONL logs, CLI stats, zero external storage
- 🔒 **Privacy First** - All processing local, no cloud upload

## Quick Start

```bash
# 1. Install
npm install

# 2. Authenticate with Gmail
npm run auth

# 3. Configure webhook & labels
npm run setup

# 4. Edit your profile
nano resources/profile.json

# 5. Test (shows TUI popup)
npm run dev

# 6. Production (background service)
npm start
# or systemd:
sudo systemctl start jobs-watcher
```

See [`QUICKSTART.md`](QUICKSTART.md) for detailed steps.

## How It Works

```
Gmail Alert
    ↓
Pub/Sub Webhook
    ↓
Parse Email (7 platforms: Indeed, LinkedIn, VietnamWorks, CareerLink, TopJob, ITviec, TopCV)
    ↓
Extract Requirements (skills, experience level, responsibilities)
    ↓
Match with Profile (calculate score 0-100%)
    ↓
Generate Materials (CV + resume + cover letter with job-specific variables)
    ↓
User Action → Apply / Skip / Queue
    ↓
Log to JSONL (track stats, patterns, improvements)
```

### Match Scoring Algorithm

Score is calculated from 0-100% based on:

1. **Skill Overlap** (60% weight)
   - Count: how many job requirements match your skills
   - Formula: `matched_skills / required_skills * 100`
   - Example: Job needs 5 skills, you have 4 → 80%

2. **Experience Level** (25% weight)
   - Job level (Junior/Mid/Senior) vs your experience
   - Perfect match: 100%, adjacent level: 70%, far level: 0%
   - Example: Senior position, you're Senior → 100%

3. **Keyword Relevance** (15% weight)
   - Description mentions your skills
   - Keywords: "proficiency with", "experience in", "familiar with"
   - Example: "5+ years TypeScript" + you have TypeScript → bonus points

**Formula**: `(skills_score × 0.6) + (level_score × 0.25) + (keywords_score × 0.15)`

Higher scores → better match → more likely to apply.

## Configuration

Create `.env` from `.env.example`:

```bash
cp .env.example .env
nano .env
```

Key variables:
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` - From Google Cloud Console
- `GMAIL_TOPIC_NAME` - Pub/Sub topic (e.g., `projects/YOUR_ID/topics/job-alerts`)
- `WEBHOOK_PORT` - Server port (default: 3000)
- `FEATURE_TUI=true` - Show interactive popup (dev only)

## File Structure

```
resources/profile.json          → Your skills, experience, links
templates/
  ├── cv.tex                    → LaTeX template (edit this)
  ├── resume.tex                → LaTeX template (edit this)
  └── cover-letter.md           → Markdown template (edit this)
generated/                      → Generated materials per job
logs/                           → Action logs (JSONL format)
src/
  ├── config.ts                 → Centralized configuration
  ├── constants.ts              → Platform patterns, skills, thresholds
  ├── services/
  │   ├── gmail.ts              → Gmail API client
  │   ├── parser.ts             → Email parser
  │   ├── smart-generator.ts    → Smart CV generator
  │   ├── event-webhook.ts      → Event processor
  │   └── notifications.ts      → Notifications + logging
  └── ui/JobPopup.tsx           → TUI interface
```

## Commands

```bash
npm run dev                     # Development (TUI popup)
npm start                       # Production (background)
npm run build                   # Compile TypeScript
npm run auth                    # Authenticate with Gmail
npm run setup                   # Configure labels & webhook
npm run stats                   # Today's stats
npm run logs [days]            # Recent actions (default: 1 day)
npm run monitor                # Full dashboard
```

## Customization

### Edit Your Profile

`resources/profile.json`:
```json
{
  "name": "Your Name",
  "email": "your@email.com",
  "skills": ["TypeScript", "React", "Node.js", ...],
  "experience": [
    {
      "company": "Company Name",
      "position": "Role",
      "duration": "2020-2024",
      "description": "What you did..."
    }
  ],
  "portfolio": "https://github.com/you",
  "linkedin": "https://linkedin.com/in/you"
}
```

### Customize Templates

Edit templates in `templates/`:
- Use Handlebars syntax: `{{variable}}`
- Available variables:
  - `{{name}}` - Your name
  - `{{email}}` - Your email
  - `{{skills}}` - All your skills (comma-separated)
  - `{{experience}}` - Work history
  - `{{portfolio}}` - GitHub/portfolio link
  - `{{linkedin}}` - LinkedIn URL
  - `{{job.company}}` - Job company name
  - `{{job.position}}` - Job position/title
  - `{{job.description}}` - Job description
  - `{{matching.matchScore}}` - Match score (0-100%)
  - `{{matching.matchedSkills}}` - Skills that matched
  - `{{matching.missingSkills}}` - Skills you lack
  - `{{today}}` - Current date

**Example CV.tex**:
```latex
\documentclass{article}
\usepackage{hyperref}

\title{{{name}} - CV}
\author{\href{mailto:{{email}}}{{{email}}}}

\begin{document}
\section{Skills}
{{skills}}

\section{Experience}
{{experience}}

\section{Links}
\href{{{portfolio}}}{Portfolio} | \href{{{linkedin}}}{LinkedIn}

\end{document}
```

### Add New Platform

In `src/constants.ts`, add to `JOB_PLATFORMS`:
```typescript
MYNEWPLATFORM: {
  name: 'MyNewPlatform',
  domains: ['mynew.com'],
  patterns: [/mynew/i, /job alert/i],
}
```

## Monitoring

View stats:
```bash
npm run stats
# Output:
# Today's Stats
# Applied: 3
# Skipped: 1
# Queued: 2
# Average Match: 82%

npm run logs 7    # Last 7 days
npm run logs 30   # Last 30 days
```

Action log format (JSONL):
```json
{"timestamp":"2024-01-14T10:30:15Z","jobId":"msg123","company":"TechCorp","position":"Senior SWE","action":"apply","matchScore":92}
```

## Ubuntu Systemd Setup

Create service:
```bash
sudo tee /etc/systemd/system/jobs-watcher.service > /dev/null <<EOF
[Unit]
Description=Jobs Watcher
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER/node_projects/jobs-watcher
ExecStart=/usr/bin/node dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable jobs-watcher
sudo systemctl start jobs-watcher
sudo systemctl status jobs-watcher
```

View logs:
```bash
sudo journalctl -u jobs-watcher -f
```

## Testing

```bash
npm test                        # All tests
npm run test:unit              # Unit tests only
npm run test:watch             # Watch mode
```

Coverage: **74%** - Parser, generator, notifications, logging all tested.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Service won't start | Run `npm run dev` to see errors |
| No jobs arriving | Check Gmail label, Pub/Sub topic, webhook logs |
| Low match scores | Add more skills/experience to `resources/profile.json` |
| Generated files wrong | Check templates, verify variables |
| Notifications not working | Install `notify-send` (Linux) or check system settings |

## What's NOT Included

- VS Code extension (can add later)
- REST API (can add later)
- Database (event-driven, no persistence needed)
- ML matching (pattern-based matching works well)

## Performance

| Operation | Time | Memory |
|-----------|------|--------|
| Parse email | ~100ms | ~5MB |
| Match profile | ~20ms | ~1MB |
| Generate CV | ~200ms | ~10MB |
| **Total per job** | **~500ms** | **~20MB peak** |

## License

MIT

---

**Questions?** Check #codebase or run `npm run dev` to test locally.