# Interview Preparation - Visual Flowcharts

**Last Updated:** March 3, 2026  
**Purpose:** Visual representations of key workflows and processes

---

## 🗺️ System Architecture Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ENTRY POINT                                  │
│                       README.md (Hub)                                │
│                  "Which file should I read?"                         │
└────┬────────────────────────────┬───────────────────────────────┬───┘
     │                            │                               │
     ▼                            ▼                               ▼
┌─────────────┐          ┌─────────────────┐           ┌──────────────┐
│ Quick Start │          │ System Docs     │           │ Daily Tools  │
│             │          │                 │           │              │
│ QUICKSTART  │          │ STRUCTURE.md    │           │ daily-*.md   │
│ (7 days)    │          │ SYSTEM-DESIGN   │           │ QUESTION-    │
│             │          │ QUICK-REFERENCE │           │ TRACKER.md   │
└─────┬───────┘          └────────┬────────┘           └──────┬───────┘
      │                           │                           │
      └───────────────┬───────────┴───────────────────────────┘
                      │
                      ▼
           ┌─────────────────────┐
           │  STRATEGY LAYER      │
           │                      │
           │  WORKFLOW.md         │
           │  (4-week plan)       │
           └──────────┬───────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
         ▼            ▼            ▼
    ┌────────┐  ┌─────────┐  ┌──────────┐
    │gaps.md │  │interview│  │recruiter-│
    │(What to│  │-prep.md │  │enforced  │
    │ fix)   │  │(Examples│  │(Standards│
    └────────┘  └─────────┘  └──────────┘
                      │
                      ▼
           ┌─────────────────────┐
           │  EVALUATION LAYER    │
           │                      │
           │  RESPONSE-EVALUATION │
           │  -FRAMEWORK.md       │
           │  (Scoring system)    │
           └──────────────────────┘
```

---

## 🔄 Daily Practice Loop (Detailed)

```
START
  │
  ▼
┌───────────────────────────────────────┐
│ MORNING (Optional 10-15 min)          │
│                                       │
│ • Review yesterday's learning log     │
│ • Check QUESTION-TRACKER.md progress  │
│ • Remind yourself of 5-block framework│
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 1: SELECT (2 min)                │
│                                       │
│ Open QUESTION-TRACKER.md              │
│ ↓                                     │
│ Decision: What to practice?           │
│   • Lowest scoring question?          │
│   • Gap-focused (gaps.md)?            │
│   • Market-specific?                  │
│   • New question?                     │
│ ↓                                     │
│ Mark question in tracker              │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 2: PREPARE (1 min)               │
│                                       │
│ cp daily-compression-template.md \    │
│    daily-20260303.md                  │
│ ↓                                     │
│ Open new file for editing             │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 3: FRAMEWORK REVIEW (5 min)      │
│                                       │
│ Recite from memory:                   │
│ ✓ 1. Validation                       │
│ ✓ 2. Service                          │
│ ✓ 3. Persistence                      │
│ ✓ 4. External                         │
│ ✓ 5. Failure                          │
│ ↓                                     │
│ Write 1-sentence definition for each  │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 4: FOCUS (10 min)                │
│                                       │
│ • Paste question into template        │
│ • Set target market                   │
│ • Note success criteria               │
│ • Start timer (60s or 45min)          │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 5: BUILD/RESPOND (25 min)        │
│         🔴 CORE PRACTICE               │
│                                       │
│ Write your answer:                    │
│ • Verbal: Type as you'd speak         │
│ • Code: Implement feature             │
│ ↓                                     │
│ While answering, think:               │
│ ✓ Am I covering all 5 blocks?         │
│ ✓ Am I labeling layers clearly?       │
│ ✓ Am I within time limit?             │
│ ✓ Did I mention edge cases?           │
│ ↓                                     │
│ Stop timer when done                  │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 6: UNPACK (10 min)               │
│                                       │
│ Answer reflection questions:          │
│ • Why this approach?                  │
│ • What edge cases handled?            │
│ • What would I improve at scale?      │
│ • How does this fit market expects?   │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 7: SELF-ASSESS (5 min)           │
│                                       │
│ Rate yourself (1-5):                  │
│ ☐ 5-Block Framework Used?             │
│ ☐ Under Time Limit?                   │
│ ☐ 2+ Edge Cases?                      │
│ ☐ Clear Error Handling?               │
│ ☐ Market-Appropriate?                 │
│ ↓                                     │
│ Score: ___/5                          │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 8: COMPARE (10 min)              │
│                                       │
│ Open interview-preparation.md         │
│ ↓                                     │
│ Find matching question example        │
│ ↓                                     │
│ Compare:                              │
│ • Structure (5 blocks present?)       │
│ • Clarity (easier to follow?)         │
│ • Depth (enough detail?)              │
│ • Time (similar length?)              │
│ ↓                                     │
│ Note what to improve next time        │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 9: EVALUATE (5 min)              │
│                                       │
│ Open RESPONSE-EVALUATION-FRAMEWORK.md │
│ ↓                                     │
│ Check against:                        │
│ • Red Flags (clarity, over-complex?)  │
│ • Scoring Rubric (match your score?)  │
│ • Evaluation Checklist                │
│ ↓                                     │
│ Confirm or adjust your self-score     │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 10: TRACK (3 min)                │
│                                       │
│ Open QUESTION-TRACKER.md              │
│ ↓                                     │
│ Find your question's tracking table   │
│ ↓                                     │
│ Fill in row:                          │
│ • Attempt number                      │
│ • Date (today)                        │
│ • Score (your 1-5 rating)             │
│ • Time (actual seconds/minutes)       │
│ • Blocks Present (V/S/P/E/F)          │
│ • Missing/Weak (what needs work)      │
│ • Improvement Notes                   │
└───────────────┬───────────────────────┘
                │
                ▼
┌───────────────────────────────────────┐
│ STEP 11: REFLECT (4 min)              │
│                                       │
│ In daily file, Learning Log section:  │
│ • What did I learn today?             │
│ • What surprised me?                  │
│ • What will I do differently next?    │
│ • Ready to master or needs retry?     │
└───────────────┬───────────────────────┘
                │
                ▼
              END
             (Save all files)

TOTAL TIME: 60-75 minutes
```

---

## 🎯 Question Mastery Path

```
Question Selected from QUESTION-TRACKER.md
              │
              ▼
┌─────────────────────────┐
│ ATTEMPT 1 (Fresh)        │
│                         │
│ Practice blindly        │
│ Score: Usually 2-3/5    │
│ Learn: What's missing?  │
└────────┬────────────────┘
         │
         ▼
    Wait 2-3 days
         │
         ▼
   Review example from
   interview-preparation.md
         │
         ▼
┌─────────────────────────┐
│ ATTEMPT 2 (Informed)     │
│                         │
│ Practice with learnings │
│ Score: Usually 3-4/5    │
│ Learn: Refinements      │
└────────┬────────────────┘
         │
         ▼
    Wait 2-3 days
         │
         ▼
   Study red flags from
   RESPONSE-EVALUATION-
   FRAMEWORK.md
         │
         ▼
┌─────────────────────────┐
│ ATTEMPT 3 (Mastery)      │
│                         │
│ Practice confidently    │
│ Score: Target 5/5       │
│ Learn: Internalized!    │
└────────┬────────────────┘
         │
         ├─ Score = 5/5? ──> Mark as MASTERED ✓
         │                   Move to next question
         │
         └─ Score < 5/5? ──> Attempt 4 needed
                             Focus on specific gap
```

---

## 📊 Gap Closure Timeline

```
WEEK 1: FOUNDATION
│
├─ Day 1-2: Learn 5-block framework
│   └─> Practice Q1.1 (POST /orders)
│
├─ Day 3-4: Apply framework consistently  
│   └─> Retry Q1.1 + Practice Q1.2 (Idempotency)
│
├─ Day 5-6: Build answer bank
│   └─> Practice Q1.4 (GET /orders)
│
└─ Day 7: Weekly review
    └─> Update QUESTION-TRACKER.md
    └─> Assess: Can I recite 5 blocks? ✓
    └─> Count: 3 questions attempted ✓

════════════════════════════════════════

WEEK 2-3: SPECIALIZATION
│
├─ Choose market focus (e.g., Singapore)
│   └─> Read recruiter-enforced.md SG section
│
├─ Practice market-specific questions
│   └─> Q4.1 (Transaction handling)
│   └─> Q1.2 (Idempotency - SG expects this!)
│
├─ Build market answer bank
│   └─> 5+ questions tailored to SG expectations
│
└─ Weekly review (both weeks)
    └─> Count: 10+ total questions attempted ✓
    └─> Average score improving? ✓
    └─> Market expectations understood? ✓

════════════════════════════════════════

WEEK 4+: SIMULATION & REFINEMENT
│
├─ Mock Interview 1
│   └─> 3 questions, timed, scored
│   └─> Use recruiter-enforced.md rubric
│
├─ Address red flags
│   └─> RESPONSE-EVALUATION-FRAMEWORK.md
│   └─> Re-practice weak areas
│
├─ Mock Interview 2
│   └─> Different 3 questions
│   └─> Compare scores with Mock 1
│
└─ Continuous refinement
    └─> Weekly reviews continue
    └─> New questions as needed
    └─> Track until interview-ready ✓
```

---

## 🌊 Weekly Review Flow

```
SUNDAY (30-45 min)
  │
  ▼
┌─────────────────────────────────┐
│ COLLECT (5 min)                  │
│                                 │
│ • Gather all daily-*.md files   │
│ • Count total practice sessions │
│ • Review at high level          │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ ANALYZE (15 min)                 │
│                                 │
│ Open QUESTION-TRACKER.md        │
│ ↓                               │
│ Calculate:                      │
│ • Average score this week       │
│ • Questions attempted           │
│ • Questions mastered (5/5)      │
│ • Most common missing block     │
│ • Time management trend         │
│ ↓                               │
│ Update Progress Dashboard       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ REFLECT (10 min)                 │
│                                 │
│ Open gaps.md                    │
│ ↓                               │
│ For each gap:                   │
│ • Improving? ✅                  │
│ • New issues? 🔍                 │
│ • Persistent? 🚩                 │
│ ↓                               │
│ Update gap status               │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ PLAN (10 min)                    │
│                                 │
│ Open QUESTION-TRACKER.md        │
│ ↓                               │
│ Fill Weekly Planning Template:  │
│ • Primary focus (Gap 1/2/3)     │
│ • Target market                 │
│ • Questions to practice Mon-Fri │
│ • Mastery goal (how many 5/5?)  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│ COMMIT (5 min)                   │
│                                 │
│ Write down:                     │
│ • This week I will focus on __  │
│ • I will practice ___ questions │
│ • I will master ___ questions   │
│ ↓                               │
│ Save and close                  │
└─────────────────────────────────┘
         │
         ▼
  READY FOR WEEK AHEAD
```

---

## 🔀 Decision Tree: What to Practice Today?

```
"What should I practice today?"
            │
            ▼
    ┌───────────────┐
    │ Check day of  │
    │ week          │
    └───┬───────────┘
        │
        ├─ Monday ────────> Fresh start
        │                   └> Pick new question from tracker
        │
        ├─ Tuesday ──────> Review mode
        │                   └> Retry Monday's question OR new question
        │
        ├─ Wednesday ────> Gap focused
        │                   └> Open gaps.md, pick weakness area
        │
        ├─ Thursday ─────> Market specific
        │                   └> Practice target market question
        │
        ├─ Friday ───────> Freestyle
        │                   └> Your choice OR hardest question
        │
        └─ Weekend ──────> Review + Planning
                            └> Sunday: Weekly review
                            └> Saturday: Optional extra practice

OVERRIDE CONDITIONS:
┌──────────────────────────────────────┐
│ If question scored 3/5 or lower      │
│ AND it's been 2-3 days               │
│ ──> Retry that question TODAY        │
│                                      │
│ If approaching interview date        │
│ AND gap still not closed             │
│ ──> Focus ONLY on that gap           │
│                                      │
│ If mock interview scheduled          │
│ AND < 3 days away                    │
│ ──> Practice similar questions       │
└──────────────────────────────────────┘
```

---

## 🎭 Mock Interview Process

```
PREPARATION (30 min before)
  │
  ├─> Read recruiter-enforced.md for target market
  ├─> Review 5-block framework (recite)
  ├─> Clear workspace, set timer
  └─> Prepare: interview-preparation.md open (for reference AFTER)
  │
  ▼
START MOCK INTERVIEW
  │
  ▼
┌───────────────────────────────────┐
│ QUESTION 1 (10 min)                │
│                                   │
│ • Read question                   │
│ • Set timer: 90 seconds           │
│ • Answer verbally (or type)       │
│ • Stop timer when done            │
│ • Note time taken: ___s           │
└─────────┬─────────────────────────┘
          │
          ▼
┌───────────────────────────────────┐
│ QUESTION 2 (10 min)                │
│ (Same process)                    │
└─────────┬─────────────────────────┘
          │
          ▼
┌───────────────────────────────────┐
│ QUESTION 3 (10 min)                │
│ (Same process)                    │
└─────────┬─────────────────────────┘
          │
          ▼
BREAK (5 min)
  │
  ▼
EVALUATION PHASE (30 min)
  │
  ├─> For each question:
  │   ├─> Score using recruiter-enforced.md rubric
  │   ├─> Check for red flags (RESPONSE-EVALUATION-FRAMEWORK.md)
  │   ├─> Compare to example answers
  │   └─> Note improvements needed
  │
  ▼
┌───────────────────────────────────┐
│ TOTAL SCORE                        │
│                                   │
│ Q1: ___/10 pts                    │
│ Q2: ___/10 pts                    │
│ Q3: ___/10 pts                    │
│ ─────────────                     │
│ Total: ___/30 pts                 │
│                                   │
│ Pass threshold: 24/30 (80%)       │
└─────────┬─────────────────────────┘
          │
          ├─ Score ≥ 24/30? ──> READY FOR REAL INTERVIEW ✓
          │
          └─ Score < 24/30? ──> Identify gaps, practice more
                                Schedule another mock in 1 week
```

---

## 🧩 File Integration Map

```
           ┌─── Answer: What should I read?
           │
      README.md
           │
           ├─── New to system? ──> QUICKSTART.md
           │                       (Follow Day 1-7)
           │
           ├─── Need quick ref? ──> QUICK-REFERENCE.md
           │                        (Print & use daily)
           │
           ├─── Lost/confused? ──> STRUCTURE.md
           │                       (See how files connect)
           │
           ├─── Want big picture? ──> SYSTEM-DESIGN.md
           │                          (Complete system overview)
           │
           └─── Ready to practice? ──> daily-compression-template.md
                                       (Copy and fill out)
                                       │
                  ┌────────────────────┴───────────────────┐
                  │                                        │
                  ▼                                        ▼
         QUESTION-TRACKER.md                  interview-preparation.md
         (Pick question)                      (See examples)
                  │                                        │
                  └────────┬───────────────────────────────┘
                           │
                           ▼
                  Write your answer
                           │
                  ┌────────┴────────┐
                  │                 │
                  ▼                 ▼
    RESPONSE-EVALUATION         recruiter-enforced.md
    -FRAMEWORK.md               (Market standards)
    (Score yourself)
                  │
                  ▼
         Update QUESTION-TRACKER.md
         (Log attempt)
                  │
                  ▼
         Weekly review cycle
         (Update gaps.md)
```

---

## 📈 Progress Visualization

```
BEGINNER (Week 1)
┌────────────────────────────────────┐
│ Questions: ████░░░░░░░░ 25%         │
│ Mastery:   █░░░░░░░░░░░ 8%          │
│ Gaps:      ████████░░░░ 33% closed  │
│ Time:      Over 60s often           │
└────────────────────────────────────┘

INTERMEDIATE (Week 2-3)
┌────────────────────────────────────┐
│ Questions: ████████░░░░ 66%         │
│ Mastery:   ████░░░░░░░░ 33%         │
│ Gaps:      ████████████ 66% closed  │
│ Time:      Mostly under 60s         │
└────────────────────────────────────┘

READY (Week 4+)
┌────────────────────────────────────┐
│ Questions: ███████████░ 90%         │
│ Mastery:   ████████░░░░ 66%         │
│ Gaps:      ███████████░ 90% closed  │
│ Time:      Consistently under 60s   │
└────────────────────────────────────┘
            ↓
    INTERVIEW READY ✓
```

---

## 🎯 Success Path Summary

```
START
  ↓
Read README.md (15 min)
  ↓
Read QUICKSTART.md Day 1 (30 min)
  ↓
First Practice Session (60 min)
  ↓
Daily Practice Loop (60 min/day × 7 days)
  ↓
Weekly Review (30 min)
  ↓
Repeat Daily Practice (Week 2-3)
  ↓
Mock Interview 1 (60 min)
  ↓
Address Gaps (Daily practice continues)
  ↓
Mock Interview 2 (60 min)
  ↓
┌────────────────────┐
│ INTERVIEW READY ✓  │
│                    │
│ • 20+ sessions     │
│ • 10+ mastered     │
│ • 1+ gap closed    │
│ • Mock score 80%+  │
└────────────────────┘
  ↓
REAL INTERVIEW
  ↓
SUCCESS! 🎉
```

---

**Print This Page for Visual Reference**

Save as: [VISUAL-FLOWS.md](VISUAL-FLOWS.md)
