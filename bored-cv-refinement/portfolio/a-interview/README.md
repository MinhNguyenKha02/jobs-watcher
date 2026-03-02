# 📚 Interview Prep - Master Navigation

**Last Updated:** March 3, 2026  
**Status:** Ready to use | **Structure:** Organized into 6 folders

---

## 🗂️ Folder Structure

```
a-interview/
├── 00-start/              ⭐ START HERE
│   └── START-HERE.md     (Entry point - read this first!)
│
├── 01-core/              📌 Core Concepts
│   ├── gaps.md           (Your 3 gaps + % closure)
│   ├── recruiter-enforced.md  (Evaluation criteria)
│   └── STRUCTURE.md      (How system works)
│
├── 02-questions/         💡 Interview Q&A
│   ├── interview-preparation.md (Ideal answers)
│   ├── SYSTEM-DESIGN.md  (System design Q&A)
│   ├── DESIGN-SUMMARY.md (Overview)
│   └── interview-questions.txt (Question bank)
│
├── 03-practice/          📝 Daily Practice
│   ├── daily-compression-template.md (Copy daily)
│   ├── QUESTION-TRACKER.md (Track all attempts)
│   └── WORKFLOW.md       (Daily structure)
│
├── 04-guides/            📖 Reference Guides
│   ├── README.md         (Full guide)
│   ├── QUICK-REFERENCE.md (1-page cheat sheet)
│   ├── QUICKSTART.md     (Quick start)
│   ├── COMMANDS.md       (Command reference)
│   ├── INTERVIEW-SETUP.md (Setup guide)
│   ├── RESPONSE-EVALUATION-FRAMEWORK.md (Scoring)
│   ├── INDEX.md          (File index)
│   └── VISUAL-FLOWS.md   (Process diagrams)
│
├── 05-scripts/           ⚙️  Bash Scripts
│   ├── interview-loop.sh  (Run interview loop)
│   ├── setup-cron.sh     (Setup daily auto-run)
│   └── interview-simulation.sh (Mock interview)
│
├── 06-outputs/           📊 Results & Logs
│   ├── loop-logs/        (Timestamped session logs)
│   └── loop-snapshots/   (Weekly summaries)
│
└── INTERVIEW-LOOP.md     (Master doc)
```

---

## 🎯 Quick Start (5 Minutes)

### Step 1: Open the Entry Point
```bash
cd 00-start
cat START-HERE.md
```

### Step 2: Pick Your Interview Type
- **Singapore** - Structured communication (5-block focus)
- **Vietnam** - Practical implementation  
- **EU** - CS fundamentals

### Step 3: Answer 5 Questions
Use the template in `START-HERE.md` to practice.

### Step 4: Log Your Score
Save to `03-practice/QUESTION-TRACKER.md`

### Step 5: Compare to Ideal
Read `02-questions/interview-preparation.md`

---

## 📋 Navigation by Task

| I want to... | Go to | File |
|---|---|---|
| **Get started NOW** | `00-start/` | `START-HERE.md` |
| **See my gaps** | `01-core/` | `gaps.md` |
| **Learn answer structure** | `01-core/` | `recruiter-enforced.md` |
| **Study ideal answers** | `02-questions/` | `interview-preparation.md` |
| **Track progress** | `03-practice/` | `QUESTION-TRACKER.md` |
| **Get daily template** | `03-practice/` | `daily-compression-template.md` |
| **Print cheat sheet** | `04-guides/` | `QUICK-REFERENCE.md` |
| **Setup auto-run** | `05-scripts/` | `setup-cron.sh` |
| **View session logs** | `06-outputs/loop-logs/` | (Timestamped files) |
| **See full guide** | `04-guides/` | `README.md` |

---

## 🚀 Running the Interview Loop

### Option 1: Manual Practice (Chat-Based)
```bash
cd 00-start
cat START-HERE.md
# Follow template, answer questions, self-score
```

### Option 2: Auto-Timed Loop (Bash)
```bash
cd 05-scripts
chmod +x interview-loop.sh
./interview-loop.sh sg 90  # Singapore market, 90s per question
# Logs to 06-outputs/loop-logs/
```

### Option 3: Daily Cron (Auto)
```bash
cd 05-scripts
chmod +x setup-cron.sh
./setup-cron.sh
# Runs every day at 10 AM
```

---

## 📊 How to Track Progress

### Daily
1. Open `03-practice/daily-compression-template.md`
2. Copy & fill in today's practice
3. Log scores in `03-practice/QUESTION-TRACKER.md`

### Weekly (Sunday)
1. Review all scores in `QUESTION-TRACKER.md`
2. Calculate averages
3. Update `01-core/gaps.md` with closure %
4. Note next week focus

### Monthly
1. Review entire `QUESTION-TRACKER.md`
2. Identify trends
3. Update `01-core/gaps.md`
4. Plan next market

---

## 📁 Folder Purpose Reference

### `00-start/` ⭐
**Entry point.** Start here if you've never used this before.
- `START-HERE.md` - First file to read

### `01-core/` 📌
**Core concepts.** What you're fixing.
- `gaps.md` - Your 3 gaps + closure percentage
- `recruiter-enforced.md` - How recruiters evaluate you
- `STRUCTURE.md` - How the system works

### `02-questions/` 💡
**Interview content.** Study material.
- `interview-preparation.md` - Ideal Q&A by market
- `SYSTEM-DESIGN.md` - System design examples
- `DESIGN-SUMMARY.md` - Overview
- `interview-questions.txt` - Raw question bank

### `03-practice/` 📝
**Daily practice.** Do this every day.
- `daily-compression-template.md` - Copy & use daily
- `QUESTION-TRACKER.md` - Log every attempt
- `WORKFLOW.md` - Daily structure

### `04-guides/` 📖
**Reference material.** Read when stuck.
- `QUICK-REFERENCE.md` - 1-page cheat sheet (print this)
- `README.md` - Complete guide
- `QUICKSTART.md` - Quick start
- Others - Specialized guides

### `05-scripts/` ⚙️
**Automation.** Run these instead of manual practice.
- `interview-loop.sh` - Timed interview loop
- `setup-cron.sh` - Daily auto-run
- `interview-simulation.sh` - Mock interview

### `06-outputs/` 📊
**Results.** Auto-generated, don't edit.
- `loop-logs/` - Timestamped session logs
- `loop-snapshots/` - Weekly summaries

---

## 🎯 Typical Day

```
Morning (10 min):
- Open 03-practice/daily-compression-template.md
- Decide: practice Q or run timed loop?

If Manual Practice (50 min):
- Open 00-start/START-HERE.md
- Answer 2-3 questions
- Self-score using checklist
- Log to QUESTION-TRACKER.md

If Timed Loop (60 min):
- Run: ./05-scripts/interview-loop.sh sg 90
- Logs auto-save to 06-outputs/loop-logs/
- Logs auto-update QUESTION-TRACKER.md

End of Day (5 min):
- Review score
- Check 01-core/gaps.md
- Plan tomorrow
```

---

## 🔗 File Cross-References

**When you need to understand:**

| Concept | Primary File | Also See |
|---------|---|---|
| Your gaps | `01-core/gaps.md` | `04-guides/QUICK-REFERENCE.md` |
| How you're scored | `01-core/recruiter-enforced.md` | `04-guides/RESPONSE-EVALUATION-FRAMEWORK.md` |
| Answer structure | `01-core/recruiter-enforced.md` | `02-questions/interview-preparation.md` |
| Daily workflow | `03-practice/WORKFLOW.md` | `04-guides/QUICKSTART.md` |
| Progress tracking | `03-practice/QUESTION-TRACKER.md` | `01-core/gaps.md` |

---

## ✅ Setup Checklist (One-Time)

- [ ] Read `00-start/START-HERE.md` (5 min)
- [ ] Review `01-core/gaps.md` to understand your gaps (5 min)
- [ ] Check `04-guides/QUICK-REFERENCE.md` (3 min)
- [ ] (Optional) Run `05-scripts/setup-cron.sh` for daily auto-run (1 min)

**Total:** ~15 minutes to setup

---

## 🎯 Success Criteria

| Week | Goal | File to Check |
|------|------|---|
| Week 1 | Gap 1 < 60% closure | `01-core/gaps.md` |
| Week 2 | Gap 2 < 50% closure | `01-core/gaps.md` |
| Week 3 | Gap 3 < 40% closure | `01-core/gaps.md` |
| Week 4 | Ready for interviews | All gaps > 70% |

---

## 🚨 Stuck?

| Problem | Solution |
|---|---|
| Don't know where to start | Go to `00-start/START-HERE.md` |
| Don't understand my gaps | Read `01-core/gaps.md` |
| Don't know if answer is good | Compare to `02-questions/interview-preparation.md` |
| Want to see my progress | Check `03-practice/QUESTION-TRACKER.md` |
| Need to understand scoring | Read `01-core/recruiter-enforced.md` |
| Want to automate practice | Run `05-scripts/interview-loop.sh` |

---

## 📞 Command Reference

```bash
# Manual practice (interactive)
cat 00-start/START-HERE.md

# Timed interview loop
./05-scripts/interview-loop.sh sg 90

# Setup daily auto-run
./05-scripts/setup-cron.sh

# View progress
cat 03-practice/QUESTION-TRACKER.md

# View latest log
ls -t 06-outputs/loop-logs/ | head -1 | xargs cat

# View your gaps
cat 01-core/gaps.md
```

---

## 📈 Month 1 Plan

```
Week 1: Gap 1 (Communication)
- Monday-Friday: Answer 5 SG questions daily
- Folder: 00-start/START-HERE.md + 02-questions/interview-preparation.md
- Track: 03-practice/QUESTION-TRACKER.md

Week 2: Gap 2 (Abstraction)
- Monday-Friday: Answer 5 VN questions daily
- Focus: Simple CRUD, no over-engineering
- Track: 03-practice/QUESTION-TRACKER.md

Week 3: Gap 3 (Code)
- 3x 45-minute timed coding challenges
- Use: 05-scripts/interview-loop.sh
- Track: 06-outputs/loop-logs/

Week 4: Integration
- 3x full mock interviews (all gaps)
- Use: 05-scripts/interview-simulation.sh
- Target: 70%+ closure on all gaps
```

---

**Ready? Start with:** `cd 00-start && cat START-HERE.md`

---

End of README.md
