# Quick Start Guide

## Prerequisites

- Node.js 18+
- Gmail account
- Google Cloud project with Pub/Sub enabled

## Setup (5 minutes)

### 1. Install

```bash
cd jobs-watcher
npm install
```

### 2. Authenticate

```bash
npm run auth
```

Opens browser → authorize Gmail access → creates `token.json` locally.

### 3. Configure

```bash
npm run setup
```

Asks for:
- Pub/Sub topic name (from Google Cloud)
- Email label name (default: "Job Alerts")

Sets up webhook listener.

### 4. Edit Profile

```bash
nano resources/profile.json
```

Add your skills, experience, links.

### 5. Test

```bash
npm run dev
```

Send yourself a test job email → watch TUI popup → try Apply/Skip/Queue.

### 6. Production

```bash
npm run build
npm start
```

Runs in background, gets system notifications instead of TUI.

Or use systemd (see README.md).

## Common Issues

**"GMAIL_CLIENT_ID required"**
- `.env` is missing or incomplete
- Copy from `.env.example`, add your values

**"No jobs arriving"**
- Check Gmail has label "Job Alerts"
- Verify Pub/Sub topic name in `.env`
- Run `npm run dev` to see webhook errors

**"Generated files look wrong"**
- Edit `templates/cv.tex`, `templates/resume.tex`
- Check variable names match `resources/profile.json`

---

See `README.md` for full reference.