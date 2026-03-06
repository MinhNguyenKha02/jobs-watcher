# 🎯 Interview Prep - START HERE

**Last Updated:** March 3, 2026  
**Purpose:** Single entry point. Navigate to what you need. Start your interview loop.

---

## 📋 Quick Navigation Table

**Lost? Find your situation below:**

| Your Situation | Go To | Time | What You'll Do |
|---|---|---|---|
| **First time here** | [Quick Start (5 min)](#quick-start) | 5 min | Understand the system |
| **Want to practice NOW** | [Start Interview Loop](#start-interview-loop) | 60 min | Answer questions + get feedback |
| **Don't know my gaps** | [gaps.md](gaps.md) | 5 min | See what you're weak at |
| **Want example answers** | [interview-preparation.md](interview-preparation.md) | 20 min | Learn from ideal responses |
| **Need to score myself** | [recruiter-enforced.md](recruiter-enforced.md) | 10 min | Understand evaluation criteria |
| **Track my progress** | [QUESTION-TRACKER.md](QUESTION-TRACKER.md) | 5 min | See your improvement trend |
| **Need daily template** | [daily-compression-template.md](daily-compression-template.md) | 60 min | Copy & do today's practice |
| **Confused about system** | [STRUCTURE.md](STRUCTURE.md) | 15 min | See how all files connect |
| **Want quick cheat sheet** | [QUICK-REFERENCE.md](QUICK-REFERENCE.md) | 5 min | Print & use daily |
| **Full understanding** | [README.md](README.md) | 30 min | Complete overview |

---

## 🚀 Quick Start (5 Minutes)

### What This System Does

You have **3 gaps** to close:

| Gap | Problem | How to Fix |
|-----|---------|-----------|
| **Gap 1: Communication** | Your ideas are good but hard to follow | Practice 5-block structure (60s answers) |
| **Gap 2: Over-Abstraction** | You jump to advanced patterns too fast | Show simple CRUD first |
| **Gap 3: Code Under Pressure** | Hard to code + explain simultaneously | Timed 45-min coding challenges |

### The Loop (Repeat Daily)

```
1. Pick a question (2 min)
2. Answer it (30 min)
3. Self-score it (5 min)
4. Compare to ideal answer (15 min)
5. Log your score (3 min)
6. Identify what to improve (5 min)

Total: 60 minutes
```

### Your Target

By **Week 4**, you should be ready for Singapore junior backend interviews.

### MicroQA Snapshot Mode (Simple Script)

Use the script for one-by-one timed Q→A practice:

```bash
chmod +x ../05-scripts/interview-simulation.sh
../05-scripts/interview-simulation.sh ../02-questions/interview-questions.txt 2
```

How it behaves:

- Shows one question at a time
- Starts timer and collects multiline input
- Type `DONE` to submit early
- Saves per-question snapshot with state: `completed` or `timed_out`

Output files:

- `../06-outputs/loop-logs/`
- `../06-outputs/loop-snapshots/<session-id>/`

### What Is Enforced

- **Script-enforced:** time limit, one-by-one flow, answer capture, state logging
- **Rubric-enforced (manual):** answer quality using [../01-core/recruiter-enforced.md](../01-core/recruiter-enforced.md)
- **Quality rules (manual):** response structure and red flags from [../04-guides/RESPONSE-EVALUATION-FRAMEWORK.md](../04-guides/RESPONSE-EVALUATION-FRAMEWORK.md)

---

## ▶️ Start Interview Loop (Right Now, 60 min)

**Choose your market + answer 5 questions:**

### Option A: Singapore (SG) - Structured Communication
**Focus:** 5-block structure (Validation → Service → Persistence → External → Failure)

**Questions:**
1. Design a POST /orders endpoint for e-commerce
2. How would you handle duplicate payment requests?
3. A payment API returns 500. What do you do?
4. Design a user registration flow
5. Build an inventory management system

**Time per question:** 10-12 minutes  
**Success:** All 5 blocks mentioned in each answer

---

### Option B: Vietnam (VN) - Practical Implementation
**Focus:** Real-world API building + error handling

**Questions:**
1. Build a payment charge endpoint with retry logic
2. Show your DTO validation approach
3. How would you integrate an external payment provider?
4. Design a webhook handler for payment status
5. Build a simple order API from scratch

**Time per question:** 10-12 minutes  
**Success:** Working code + clear explanation

---

### Option C: EU - CS Fundamentals
**Focus:** Algorithm thinking + testing

**Questions:**
1. Explain the time complexity of your order processing
2. Write unit tests for validation logic
3. How would you handle race conditions?
4. Optimize a database query
5. Explain your approach to error handling

**Time per question:** 10-12 minutes  
**Success:** Technical depth + clear reasoning

---

## 📝 SG Loop Template

**Market:** Singapore | **Time Limit:** 60 seconds per answer | **Focus:** 5 Blocks

### Q1: Design a POST /orders endpoint

**Your Answer:**
```
[Type your answer here]
```

**Self-Assessment:**
- [ ] Validation block mentioned? (Check user auth, item availability)
- [ ] Service block mentioned? (Calculate price, apply discounts)
- [ ] Persistence block mentioned? (Database transaction)
- [ ] External block mentioned? (Payment processor)
- [ ] Failure block mentioned? (Error recovery)

**Score:** ___/5 blocks

**Time Taken:** _____ seconds | **Target:** < 90 seconds

---

### Q2: How would you handle a duplicate payment request?

**Your Answer:**
```
[Type your answer here]
```

**Self-Assessment:**
- [ ] Validation block: Idempotency key required?
- [ ] Service block: Check if key already processed?
- [ ] Persistence block: Store idempotency key + result?
- [ ] External block: Pass key to payment provider?
- [ ] Failure block: Return cached result on retry?

**Score:** ___/5 blocks

**Time Taken:** _____ seconds | **Target:** < 90 seconds

---

### Q3: A payment API returns 500. What do you do?

**Your Answer:**
```
[Type your answer here]
```

**Self-Assessment:**
- [ ] Validation: Recognize this is external failure, not client error?
- [ ] Service: Decide not to mark order failed immediately?
- [ ] Persistence: Log the failed attempt?
- [ ] External: Implement exponential backoff retry?
- [ ] Failure: Define max retries + final recovery?

**Score:** ___/5 blocks

**Time Taken:** _____ seconds | **Target:** < 90 seconds

---

### Q4: Design a user registration flow

**Your Answer:**
```
[Type your answer here]
```

**Self-Assessment:**
- [ ] Validation: Email format + password strength?
- [ ] Service: Check email uniqueness before saving?
- [ ] Persistence: Store password hash (not plain text)?
- [ ] External: Send confirmation email?
- [ ] Failure: Handle email service timeout gracefully?

**Score:** ___/5 blocks

**Time Taken:** _____ seconds

---

### Q5: Build an inventory management system

**Your Answer:**
```
[Type your answer here]
```

**Self-Assessment:**
- [ ] Validation: Check stock > 0?
- [ ] Service: Reservation logic for concurrent orders?
- [ ] Persistence: Transaction to prevent overselling?
- [ ] External: Call supplier API if stock low?
- [ ] Failure: Handle concurrent update race condition?

**Score:** ___/5 blocks

**Time Taken:** _____ seconds

---

## 📊 Loop Summary

**Session Date:** ___________  
**Market:** Singapore  
**Questions Answered:** 5  
**Total Time:** _____ minutes (target: 60 min)

| Q | Blocks | Time | Notes |
|---|--------|------|-------|
| 1 | ___/5 | ___s | |
| 2 | ___/5 | ___s | |
| 3 | ___/5 | ___s | |
| 4 | ___/5 | ___s | |
| 5 | ___/5 | ___s | |
| **AVG** | **___/5** | **___s** | |

**Strongest Block:** _________ (present in all 5 Q's)  
**Weakest Block:** _________ (missing in most Q's)

**What to improve next:** _____________________________________

---

## 📈 Progress Tracking

After each loop, update [QUESTION-TRACKER.md](QUESTION-TRACKER.md):

```
Q1 Order API:
- Attempt 1: 3/5 blocks (75s)
- Attempt 2: 4/5 blocks (70s)
- Attempt 3: 5/5 blocks (65s) ✅ MASTERED
```

---

## 🔗 File Map (When You Need More)

| If You Need | File | Purpose |
|---|---|---|
| See your gaps | [gaps.md](gaps.md) | Know what you're fixing |
| Learn from examples | [interview-preparation.md](interview-preparation.md) | Study ideal answers |
| Understand scoring | [recruiter-enforced.md](recruiter-enforced.md) | Know how you're being evaluated |
| Daily practice template | [daily-compression-template.md](daily-compression-template.md) | Copy & practice |
| Track all attempts | [QUESTION-TRACKER.md](QUESTION-TRACKER.md) | See your improvement over time |
| Quick memorization | [QUICK-REFERENCE.md](QUICK-REFERENCE.md) | Print & use at desk |
| Full system overview | [STRUCTURE.md](STRUCTURE.md) | Understand all connections |
| Complete guide | [README.md](README.md) | Deep dive everything |

---

## ✅ Next Steps

### Setup Confirmation (Ready Loop Pack)

- [ ] I can run `../05-scripts/interview-simulation.sh`
- [ ] I selected my market target (SG/VN/EU/other)
- [ ] I know my role target (junior backend)
- [ ] I will score with market rubric from `recruiter-enforced.md`
- [ ] I will log outcomes in `QUESTION-TRACKER.md`

### After This Loop:
1. ✅ Complete all 5 questions above
2. ✅ Log scores in summary table
3. ✅ Update [QUESTION-TRACKER.md](QUESTION-TRACKER.md)
4. ✅ Note which blocks you struggle with
5. ✅ Tomorrow: Focus on weakest block

### Daily:
- Copy [daily-compression-template.md](daily-compression-template.md)
- Answer 1-2 questions (pick from [QUESTION-TRACKER.md](QUESTION-TRACKER.md))
- Self-score using 5-block checklist
- Log in tracker
- Compare to [interview-preparation.md](interview-preparation.md)

### Weekly (Every Sunday):
- Review all attempts
- Calculate average scores
- Identify improvement trend
- Plan next week focus
- Update [gaps.md](gaps.md)

---

## 💡 Pro Tips

**Do:**
- ✅ Answer in 60-90 seconds (like real interview)
- ✅ Explicitly name each block ("Validation: ...", "Service: ...")
- ✅ Log every attempt (even weak ones)
- ✅ Compare to ideal answer after
- ✅ Repeat same question 3x before moving on

**Don't:**
- ❌ Rush through without self-assessment
- ❌ Skip logging (tracking is how you see progress)
- ❌ Jump to new questions before mastering current ones
- ❌ Answer without writing/speaking (articulation is key)
- ❌ Forget the 5-block structure (it's your answer framework)

---

## 🎯 Your Target

| Week | Goal | Evidence |
|------|------|----------|
| Week 1 | Gap 1: 60% closure | 5 questions, avg 3/5 blocks |
| Week 2 | Gap 2: 50% closure | Simple CRUD answers, no over-engineering |
| Week 3 | Gap 3: 40% closure | 1x 45-min coding, working code |
| Week 4 | Ready for Singapore | Can answer all 5-block Q's consistently |

---

## 🚨 Stuck?

| Problem | Solution |
|---------|----------|
| Don't know what a block should sound like | Read [interview-preparation.md](interview-preparation.md) → copy the structure |
| Don't know if my answer is good | Use checklist above + compare to ideal answer |
| Lost track of progress | Check [QUESTION-TRACKER.md](QUESTION-TRACKER.md) → see your trend |
| Don't understand scoring | Read [recruiter-enforced.md](recruiter-enforced.md) → see exact criteria |
| Want to understand the whole system | Read [STRUCTURE.md](STRUCTURE.md) → see how all files connect |

---

**Ready? Start your first loop now → Pick SG/VN/EU above → Answer 5 questions → Log scores.**

---

End of START-HERE.md
