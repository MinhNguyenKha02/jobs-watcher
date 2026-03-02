# Interview Preparation Codebase Structure

**Last Updated:** March 3, 2026  
**Purpose:** Master blueprint of the interview preparation system - how files connect and flow together

---

## 📐 System Architecture

### Design Principles

1. **Single Entry Point** - Start at [README.md](README.md), branch to specific needs
2. **Progressive Depth** - Quick start → Strategy → Practice → Evaluation
3. **Daily Practice Loop** - Template-driven, trackable, and improvable
4. **Feedback-Driven** - Every practice session includes self-evaluation

### Information Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    README.md (Hub)                            │
│              "What should I read today?"                      │
└────────────┬─────────────┬─────────────┬─────────────────────┘
             │             │             │
       ┌─────▼──────┐ ┌───▼─────┐ ┌────▼─────────────┐
       │QUICKSTART  │ │WORKFLOW │ │interview-prep    │
       │7-day plan  │ │Strategy │ │Example answers   │
       └─────┬──────┘ └───┬─────┘ └────┬─────────────┘
             │             │             │
             └─────────┬───┴─────────────┘
                       │
            ┌──────────▼───────────────────────────┐
            │ daily-compression-template.md        │
            │ (Copy → daily-YYYYMMDD.md)           │
            │ Your daily 60-minute practice        │
            └──────────┬───────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         │             │             │
    ┌────▼────┐  ┌────▼────┐  ┌────▼────────────┐
    │gaps.md  │  │RESPONSE-│  │recruiter-       │
    │Track    │  │EVAL     │  │enforced.md      │
    │issues   │  │Scoring  │  │Market standards │
    └─────────┘  └─────────┘  └─────────────────┘
```

---

## 🗂️ File Inventory & Roles

### Tier 1: Navigation & Entry (Read First)

| File | Role | When to Use | Key Sections |
|------|------|-------------|--------------|
| [README.md](README.md) | **Master index** - directs you to the right document based on your need | Every time you're unsure what to do next | START HERE, Core Documents |
| [QUICKSTART.md](QUICKSTART.md) | **7-day onboarding** - hands-on daily plan for first week | First time here or need quick wins | Day 1-7 breakdown, Daily deliverables |

### Tier 2: Strategy & Learning

| File | Role | When to Use | Key Sections |
|------|------|-------------|--------------|
| [WORKFLOW.md](WORKFLOW.md) | **Strategic roadmap** - 4-week plan, gap closure, market specialization | Planning ahead, understanding phases | Gap Snapshot, Interview Prep Tracks, Weekly Review |
| [gaps.md](gaps.md) | **Gap tracker** - identified weaknesses and market-specific expectations | Understanding what you're fixing | Core Gaps, Market Expectations |
| [interview-preparation.md](interview-preparation.md) | **Example library** - ideal answers with 5-block framework applied | Learning from examples, need answer inspiration | Question Sets, Ideal Responses |
| [recruiter-enforced.md](recruiter-enforced.md) | **Evaluation standards** - how you'll be scored by region | Setting up mock interviews, understanding assessment | Scoring Rubric, Regional Customization |

### Tier 3: Daily Practice & Tracking

| File | Role | When to Use | Key Sections |
|------|------|-------------|--------------|
| [daily-compression-template.md](daily-compression-template.md) | **Practice template** - structure for daily 60-minute sessions | Every day you practice (copy to new file) | All sections (Framework Review → Learning Log) |
| `daily-YYYYMMDD.md` | **Practice log** - your filled-in daily sessions | Created by YOU each day | Your answers, assessments, insights |
| [QUESTION-TRACKER.md](QUESTION-TRACKER.md) | **Progress tracker** - checklist for each question with attempt history | Planning practice sessions, tracking improvements | Question Bank, Progress Dashboard, Analysis |

### Tier 4: Evaluation & Feedback

| File | Role | When to Use | Key Sections |
|------|------|-------------|--------------|
| [RESPONSE-EVALUATION-FRAMEWORK.md](RESPONSE-EVALUATION-FRAMEWORK.md) | **Scoring system** - criteria for evaluating any technical response | Self-review, understanding quality standards | Evaluation Criteria, Red Flag Detection, Scoring Rubric |

---

## 🔄 Core Workflows

### Workflow 1: First Time Setup (Day 1)

**Goal:** Understand the system and complete first practice session

```
1. Read README.md (15 min) → Get oriented
2. Read QUICKSTART.md - Day 1 section (10 min) → Know what to do today
3. Skim WORKFLOW.md - Gap Snapshot (10 min) → Understand what you're fixing
4. Copy daily-compression-template.md → daily-20260303.md (2 min)
5. Fill out template with first question (45 min)
6. Review your answer using RESPONSE-EVALUATION-FRAMEWORK.md (10 min)
```

**Outcome:** You have one complete practice session documented

---

### Workflow 2: Daily Practice Loop (Day 2+)

**Goal:** Consistent improvement through structured practice

```
1. Open QUESTION-TRACKER.md → Select next question to practice (2 min)
2. Copy daily-compression-template.md → daily-[TODAY].md (1 min)
3. Select question source from:
   - interview-preparation.md (example-driven)
   - gaps.md (weakness-driven)
   - recruiter-enforced.md (market-driven)
4. Fill out template (45-60 min):
   ✓ Framework Review (5 min)
   ✓ Today's Focus (10 min)
   ✓ Build/Respond (25 min)
   ✓ Unpack Decisions (10 min)
   ✓ Self-Assessment (5 min)
   ✓ Learning Log (5 min)
5. Compare your answer to example in interview-preparation.md (10 min)
6. Check against scoring criteria in RESPONSE-EVALUATION-FRAMEWORK.md (5 min)
7. Update QUESTION-TRACKER.md with attempt details (3 min)
```

**Outcome:** One documented practice session with self-evaluation + progress tracked

---

### Workflow 3: Weekly Review (Every Sunday)

**Goal:** Track progress and adjust focus

```
1. Collect all daily-YYYYMMDD.md files from the week (2 min)
2. Use WORKFLOW.md - Weekly Review Checklist (20 min):
   ✓ How many 5-block frameworks completed?
   ✓ Which gaps showed improvement?
   ✓ Time management trends (under 60s consistently?)
   ✓ Market-specific expectations met?
3. Update QUESTION-TRACKER.md (10 min):
   ✓ Calculate average score for the week
   ✓ Update Progress Dashboard statistics
   ✓ Identify most common missing block
   ✓ Mark questions as "Mastered" if consistently 5/5
4. Update gaps.md with:
   - Gaps that are closing ✅
   - New gaps discovered 🔍
   - Persistent issues 🚩
5. Plan next week's focus using WORKFLOW.md tracks (10 min)
6. Fill out Weekly Planning Template in QUESTION-TRACKER.md (5 min)
```

**Outcome:** Clear understanding of progress + next week's priorities + updated trackers

---

### Workflow 4: Mock Interview Simulation (Week 4+)

**Goal:** Test readiness with recruiter-style evaluation

```
1. Read recruiter-enforced.md for target market (15 min)
2. Set up timer and select 3 questions from interview-preparation.md
3. Answer each question following 5-block framework
4. Record answers (text or voice) (45 min)
5. Score yourself using recruiter-enforced.md rubric (15 min)
6. Identify red flags using RESPONSE-EVALUATION-FRAMEWORK.md (10 min)
7. Log insights in new daily-[DATE].md file (10 min)
```

**Outcome:** Mock interview completed with scoring and feedback

---

## 📋 Quick Reference Checklists

### Before Each Practice Session

- [ ] Have I reviewed the 5-block framework? (Validation → Service → Persistence → External → Failure)
- [ ] Do I have a target question selected?
- [ ] Do I know which market I'm optimizing for? (SG/VN/TH/MY/ID/EU/US)
- [ ] Have I copied the daily template to a new file?

### During Practice Session

- [ ] Am I explicitly labeling each block in my answer?
- [ ] Am I tracking time (60s verbal / 45min code)?
- [ ] Am I thinking about edge cases as I build?
- [ ] Am I recording decisions in the Unpack section?

### After Practice Session

- [ ] Did I complete the self-assessment honestly?
- [ ] Did I compare my answer to the guide example?
- [ ] Did I log one key insight?
- [ ] Did I identify what to improve tomorrow?

### Weekly Review

- [ ] Reviewed all 7 daily practice files
- [ ] Counted completed 5-block frameworks
- [ ] Identified pattern in missing blocks
- [ ] Assessed time management trend
- [ ] Updated gaps.md with progress
- [ ] Planned next week's focus

---

## 🎯 Question Selection Matrix

Use this to decide which question to practice each day:

| Your Current Need | Read This File | Section to Use |
|-------------------|----------------|----------------|
| **Learn the framework** | [interview-preparation.md](interview-preparation.md) | Gap 1: Structural Communication, Question Set 1 |
| **Fix over-abstraction** | [interview-preparation.md](interview-preparation.md) | Gap 2: Over-Abstraction, Question Set 2 |
| **Improve live coding** | [interview-preparation.md](interview-preparation.md) | Gap 3: Code Articulation |
| **Target Singapore** | [recruiter-enforced.md](recruiter-enforced.md) + [gaps.md](gaps.md) | Singapore section |
| **Target Vietnam** | [recruiter-enforced.md](recruiter-enforced.md) + [gaps.md](gaps.md) | Vietnam section |
| **Understand scoring** | [RESPONSE-EVALUATION-FRAMEWORK.md](RESPONSE-EVALUATION-FRAMEWORK.md) | Scoring Rubric, Red Flag Detection |
| **Track weaknesses** | [gaps.md](gaps.md) | Core Gaps |
| **Need quick direction** | [QUICKSTART.md](QUICKSTART.md) | Day N that matches your experience level |

---

## 🚀 Success Metrics

### Week 1 (Foundation)
- ✅ 7 daily practice files created
- ✅ 5-block framework used in 5+ answers
- ✅ 3 recorded practice answers with all blocks present
- ✅ Understand your top 2 gaps from gaps.md

### Week 2-3 (Specialization)
- ✅ 10+ daily practice files
- ✅ Consistently under 60 seconds for verbal answers
- ✅ Market-specific answer bank (5+ answers per target region)
- ✅ At least 1 gap from gaps.md showing improvement

### Week 4+ (Simulation & Refinement)
- ✅ 2 mock interviews completed with scoring
- ✅ Red flags from RESPONSE-EVALUATION-FRAMEWORK.md identified and addressed
- ✅ Feedback integrated from weekly reviews
- ✅ Can rebuild features from scratch without references

---

## 💡 Pro Tips

### File Navigation
- **Stuck?** → Go to [README.md](README.md)
- **First week?** → Follow [QUICKSTART.md](QUICKSTART.md) day-by-day
- **Need strategy?** → Open [WORKFLOW.md](WORKFLOW.md)
- **Daily practice?** → Copy [daily-compression-template.md](daily-compression-template.md)
- **Checking quality?** → Use [RESPONSE-EVALUATION-FRAMEWORK.md](RESPONSE-EVALUATION-FRAMEWORK.md)

### Time Management
- **< 15 min:** Read one section from any guide
- **30-45 min:** Complete one practice question
- **60 min:** Full daily practice session with assessment
- **90 min:** Practice + deep comparison with examples + scoring

### Quality Control
- Every answer should have all 5 blocks identifiable
- Every practice session should have honest self-assessment
- Every week should have a review and updated gaps.md
- Every mock interview should have recruiter-style scoring

---

## 📖 How This Document Helps You

1. **Orientation** - See how all files connect in the Information Flow diagram
2. **Quick Access** - File Inventory table tells you exactly where to go
3. **Process Clarity** - Core Workflows show you step-by-step what to do
4. **Decision Support** - Question Selection Matrix helps you choose what to practice
5. **Progress Tracking** - Success Metrics show if you're on track

**Start Here:** If this is your first time, go to [README.md](README.md) → then [QUICKSTART.md](QUICKSTART.md) Day 1.

**Already Started?** Use the Daily Practice Loop workflow above.
