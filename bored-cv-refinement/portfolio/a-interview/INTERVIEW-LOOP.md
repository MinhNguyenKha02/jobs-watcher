# Interview Loop: Integrated Setup & Navigation

**Created:** March 3, 2026  
**Purpose:** Minimal setup combining interview questions, codebase topics, and progress tracking in one unified loop

---

## 🚀 Quick Start (Start Here!)

### The Interview Loop Flow

```
Read Framework → Select Question → Practice Answer → Self-Assess → 
Review Example → Compare & Improve → Log Progress → Move Next
```

**Time per loop:** 45-60 minutes  
**Frequency:** 1 loop per day  
**Expected result:** Master 1 question per day, improve 5-block framework execution

### MicroQA Snapshot Run (Simple)

```bash
chmod +x ./05-scripts/interview-simulation.sh
./05-scripts/interview-simulation.sh ./02-questions/interview-questions.txt 2
```

Script enforces:

- one-by-one question flow
- timer + input collector
- state logs: `completed` or `timed_out`

Outputs:

- `06-outputs/loop-logs/`
- `06-outputs/loop-snapshots/<session-id>/`

Quality/rubric is applied manually after each answer.

Use [03-practice/SEA-QUESTION-QUALITY-CHECKLIST.md](03-practice/SEA-QUESTION-QUALITY-CHECKLIST.md) for SG/VN trust and reflection scoring.

---

## 📚 Table of Contents

1. **[The 5-Block Framework](#the-5-block-framework)** - What every answer needs
2. **[Interview Questions](#interview-questions)** - All 10 core questions
3. **[Daily Loop Structure](#daily-loop-structure)** - 45-minute practice routine
4. **[Progress Tracking](#progress-tracking)** - How to track mastery
5. **[Reference Documents](#reference-documents)** - When to use each file
6. **[Current Progress](#current-progress)** - Your weekly dashboard

---

## The 5-Block Framework

**MEMORIZE THIS.** Every answer must clearly address all 5 blocks:

| Block | Definition | In Answers |
|-------|-----------|-----------|
| **1. VALIDATION** | Input checks, authentication, business rules, constraints | "First, validate..." |
| **2. SERVICE** | Business logic, orchestration, core functionality | "The service layer handles..." |
| **3. PERSISTENCE** | Database operations, transactions, state management | "We persist data by..." |
| **4. EXTERNAL** | Third-party APIs, integrations, external services | "External integrations would..." |
| **5. FAILURE** | Error handling, retries, recovery, edge cases | "For failures, we..." |

**Quality Check:** Can you identify each block in your answer? If not, rewrite until you can.

### Context Rules (Role + Market)

Use this order each loop:

1. Role baseline: Junior backend clarity + implementation
2. Market target rules from `01-core/recruiter-enforced.md`
3. Response quality rules from `04-guides/RESPONSE-EVALUATION-FRAMEWORK.md`

Quick market focus:

- **SG:** structured communication, transactions, consistency
- **VN:** practical implementation, external API handling
- **EU:** fundamentals, testing, algorithmic clarity
- **US:** tradeoffs, ownership, system thinking

---

## Interview Questions

### Question Set 1: API Design & Architecture

**Q1:** Tell me about a challenging project you worked on.  
*Focus: Validation + Service layers*

**Q2:** How do you approach debugging a complex issue?  
*Focus: Persistence + Failure handling*

**Q3:** Describe a time you had to learn something new quickly.  
*Focus: External integrations + Service layer*

### Question Set 2: Technical Competency

**Q4:** What's your approach to writing maintainable code?  
*Focus: Validation + Service structure*

**Q5:** Describe your experience with system design.  
*Focus: All 5 blocks in an integrated system*

**Q6:** Explain a technical concept you recently learned.  
*Focus: Clear explanation + 5-block relevance*

### Question Set 3: Behavioral & Teamwork

**Q7:** How do you handle disagreements with team members?  
*Focus: Service layer communication + Failure recovery*

**Q8:** Tell me about a time you failed and what you learned.  
*Focus: Failure block + all supporting blocks*

**Q9:** How do you prioritize when you have multiple tasks?  
*Focus: Validation + Service orchestration*

### Question Set 4: Motivation & Values

**Q10:** What motivates you in your work?  
*Focus: Service excellence + External impact*

---

## Daily Loop Structure

### ⏱️ 45-Minute Practice Routine

#### Step 1: Setup (2 minutes)

```bash
1. Pick a question from above (or QUESTION-TRACKER.md)
2. Create daily file: daily-YYYYMMDD.md
3. Copy template from daily-compression-template.md
```

**Files used:**
- [QUESTION-TRACKER.md](QUESTION-TRACKER.md) - Select next question
- [daily-compression-template.md](daily-compression-template.md) - Copy structure

#### Step 2: Framework Review (5 minutes)

```
Recite the 5 blocks out loud:
1. VALIDATION
2. SERVICE
3. PERSISTENCE
4. EXTERNAL
5. FAILURE

Then say: "Every answer has these 5 blocks"
```

**Success:** You can say them in order without looking.

#### Step 3: Practice Answer (20 minutes)

```
Write your answer to the question WITHOUT looking at examples.

Target: 60 seconds of speaking (about 200-250 words written)

Include:
- Natural opening
- Mention all 5 blocks (even briefly)
- Clear examples
- How you solved it
```

**File to use:** Daily file → Build/Respond section

#### Step 4: Self-Assessment (8 minutes)

Score yourself on 5-block presence:

```
□ VALIDATION present? (clearly stated)
□ SERVICE present? (business logic explained)
□ PERSISTENCE present? (data/state handling)
□ EXTERNAL present? (integrations mentioned)
□ FAILURE present? (error handling noted)

Score: ___ / 5

Gaps identified: ________________
```

**File to use:** Daily file → Self-Assessment section

#### Step 5: Compare to Example (10 minutes)

```
1. Read ideal answer from interview-preparation.md
2. Time yourself reading it (~60 seconds)
3. Compare structure to your answer
4. Note: Where did theirs shine? Where could yours improve?
5. Identify 1-2 specific improvements
```

**File to use:** [interview-preparation.md](interview-preparation.md)

#### Step 6: Improvement & Reflection (5 minutes)

```
Rewrite key sections based on what you learned.
Document: What will you do differently next time?
```

**File to use:** Daily file → Learning Log section

---

## Progress Tracking

### Ready-to-Run Loop Pack Checklist

- [ ] I can run `./05-scripts/interview-simulation.sh`
- [ ] I selected my current market target
- [ ] I selected my role target (junior backend)
- [ ] I will score answer quality with recruiter rubric after each question
- [ ] I will update `03-practice/QUESTION-TRACKER.md` after the session

### How to Track Your Work

**Daily (During Loop):**
- [ ] Mark question attempted in QUESTION-TRACKER.md
- [ ] Record score (1-5 based on 5-block framework)
- [ ] Note one key improvement

**Weekly (Every Saturday):**
- [ ] Update QUESTION-TRACKER.md dashboard
- [ ] Count mastered questions (3+ consecutive 5/5 scores)
- [ ] Identify weakest block across all attempts
- [ ] Plan next week's focus

**Monthly (End of month):**
- [ ] Review all daily-*.md files
- [ ] Calculate average score per question
- [ ] Compare first attempt vs. final attempt
- [ ] Identify patterns in scoring

### Progress Dashboard Template

```
Week of: [DATE]

Questions Practiced: ___ / 25
New Questions Mastered: ___ / 25
Average Score This Week: ___/5
Weakest Block: [VALIDATION/SERVICE/PERSISTENCE/EXTERNAL/FAILURE]

This Week's Questions:
- Q___: Score _/5 (Attempts: _)
- Q___: Score _/5 (Attempts: _)
- Q___: Score _/5 (Attempts: _)

Next Week's Focus:
□ Continue with Set [__]
□ Revisit Set [__] - focus on [block]
□ Practice timed responses
```

### Mastery Checklist

Track which questions you've mastered (3 consecutive 5/5 scores):

```
Q1  [ ] □□□ (attempts: _)
Q2  [ ] □□□
Q3  [ ] □□□
Q4  [ ] □□□
Q5  [ ] □□□
Q6  [ ] □□□
Q7  [ ] □□□
Q8  [ ] □□□
Q9  [ ] □□□
Q10 [ ] □□□

Total Mastered: ___ / 10
```

---

## Reference Documents

### When to Use Each File

| Situation | File | What to Do |
|-----------|------|-----------|
| **Don't know where to start** | [QUICKSTART.md](QUICKSTART.md) | Follow Day 1-7 plan |
| **Need the 5-block definition** | [QUICK-REFERENCE.md](QUICK-REFERENCE.md) | 1-minute lookup |
| **Want to see ideal answers** | [interview-preparation.md](interview-preparation.md) | Study after your attempt |
| **Need scoring standards** | [recruiter-enforced.md](recruiter-enforced.md) | Understand evaluation criteria |
| **Creating daily practice file** | [daily-compression-template.md](daily-compression-template.md) | Copy entire template |
| **Tracking question progress** | [QUESTION-TRACKER.md](QUESTION-TRACKER.md) | Log each attempt |
| **Need complete system overview** | [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) | Understand architecture |
| **Lost about file relationships** | [STRUCTURE.md](STRUCTURE.md) | See how files connect |

---

## Current Progress

### Your Starting Point

**Date Started:** [Your date here]  
**Questions Mastered:** 0/10  
**Total Attempts:** 0

### This Week's Plan

**Week of:** ___________

- [ ] Complete Q1 (Set 1) - at least 2 attempts
- [ ] Complete Q2 (Set 1) - at least 2 attempts
- [ ] Complete Q3 (Set 1) - at least 2 attempts
- [ ] Review all 3 answers for block consistency
- [ ] Identify weakest block across Set 1

### Weekly Check-In

```
After 7 days, answer these:

1. Can you recite the 5 blocks in order? YES / NO
2. How many questions did you practice? ___
3. What was your average score? ___ / 5
4. Which block appeared least in your answers? ___________
5. What's one thing you'll improve next week? ________________
```

---

## Tips for Success

### ✅ Do This

- **Start with Q1** - It's the easiest to structure
- **Say your answer aloud** - Catches awkward phrasing
- **Time yourself** - Aim for 60 seconds speaking
- **Compare immediately** - Don't wait days to review
- **Practice the same question 2-3 times** - Improvement is visible
- **Track scores** - You'll see progress over weeks

### ❌ Don't Do This

- Don't memorize answers - Understand the structure instead
- Don't skip the comparison step - That's where learning happens
- Don't practice new questions every day - Master 5 first
- Don't rate yourself a 5 until you score 5 three times - Confidence matters
- Don't do this alone - Record yourself, get feedback if possible

---

## Navigation Shortcuts

**Quick Links to Your Daily Work:**

- [Daily Compression Template](daily-compression-template.md) - Copy this every day
- [Question Tracker](QUESTION-TRACKER.md) - Log your attempts here
- [Interview Preparation Examples](interview-preparation.md) - Learn from ideal answers
- [5-Block Quick Ref](QUICK-REFERENCE.md) - 1-minute lookup

**Quick Links to Learning:**

- [Full System Design](SYSTEM-DESIGN.md) - Deep dive
- [Quick Start Guide](QUICKSTART.md) - If you're lost
- [Complete File Index](INDEX.md) - See all 14 files

---

## Your First Loop (Right Now)

**Time:** 45 minutes | **Question:** Q1 | **Goal:** Complete first loop

1. **Read** this section again (2 min)
2. **Recite** the 5 blocks (5 min)
3. **Copy** daily-compression-template.md to daily-20260303.md (1 min)
4. **Practice** your answer to Q1 (20 min)
5. **Score** yourself (8 min)
6. **Compare** to [interview-preparation.md](interview-preparation.md) (10 min)
7. **Reflect** (5 min) - What will you do differently tomorrow?

**Then:** Update [QUESTION-TRACKER.md](QUESTION-TRACKER.md) with your score and move to Q2 tomorrow.

---

**Ready? Open [daily-compression-template.md](daily-compression-template.md) and start your first loop.**
