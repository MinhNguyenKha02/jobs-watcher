# Interview Prep - Quick Reference Card

**Last Updated:** March 3, 2026  
**Purpose:** One-page quick reference for daily use

---

## 🎯 The 5-Block Framework (Memorize This!)

```
1. VALIDATION    → Input checks, auth, business rules
2. SERVICE       → Business logic, orchestration
3. PERSISTENCE   → Database ops, transactions
4. EXTERNAL      → Third-party APIs, integrations
5. FAILURE       → Error handling, retries, recovery
```

**Every answer must have all 5 blocks identifiable.**

---

## 📅 Daily Practice Routine (60 min)

```
1. Select question     → QUESTION-TRACKER.md        (2 min)
2. Copy template       → daily-YYYYMMDD.md          (1 min)
3. Framework review    → Recite 5 blocks            (5 min)
4. Practice answer     → Build/Respond section      (25 min)
5. Self-assess         → Score 1-5, note gaps       (10 min)
6. Compare to example  → interview-preparation.md   (10 min)
7. Update tracker      → Log attempt details        (3 min)
8. Learn & reflect     → Key insight                (4 min)
```

**Goal:** One question attempted, scored, and tracked per day.

---

## 📊 Scoring Yourself (5-Point Scale)

| Score | Criteria |
|-------|----------|
| **5/5** | ✅ All 5 blocks present ✅ Clear & structured ✅ Under 60s ✅ 2+ edge cases ✅ Error handling |
| **4/5** | ✅ All 5 blocks present ⚠️ Minor clarity issues OR slightly over time |
| **3/5** | ❌ Missing 1 block OR ❌ Significant clarity issues |
| **2/5** | ❌ Missing 2 blocks OR ❌ Major structural problems |
| **1/5** | ❌ Unstructured OR ❌ Missing 3+ blocks |

**Mastery = 3 consecutive attempts at 5/5**

---

## 🗂️ File Quick Access

| Need | File | Time |
|------|------|------|
| 🧭 **Lost? Start here** | [README.md](README.md) | 5 min |
| 🚀 **First week guide** | [QUICKSTART.md](QUICKSTART.md) | 15 min |
| 📋 **What to do today?** | [daily-compression-template.md](daily-compression-template.md) | 60 min |
| 📈 **Track progress** | [QUESTION-TRACKER.md](QUESTION-TRACKER.md) | 5 min |
| 🎓 **Learn from examples** | [interview-preparation.md](interview-preparation.md) | 20 min |
| 📏 **How to score?** | [RESPONSE-EVALUATION-FRAMEWORK.md](RESPONSE-EVALUATION-FRAMEWORK.md) | 10 min |
| 🌏 **Market standards** | [recruiter-enforced.md](recruiter-enforced.md) | 15 min |
| 🔧 **4-week strategy** | [WORKFLOW.md](WORKFLOW.md) | 30 min |
| 🏗️ **How files connect?** | [STRUCTURE.md](STRUCTURE.md) | 10 min |
| 🎯 **Complete system** | [SYSTEM-DESIGN.md](SYSTEM-DESIGN.md) | 20 min |

---

## ⚠️ Common Mistakes (Red Flags)

### During Practice
- ❌ Skipping the framework review (always recite 5 blocks first!)
- ❌ Not timing yourself (60s verbal / 45min code)
- ❌ Missing blocks (most common: External, Failure)
- ❌ Over-complicating junior questions (keep it simple first!)
- ❌ Not recording attempt in QUESTION-TRACKER.md

### In Answers
- ❌ Mixing layers (validation + service in same sentence)
- ❌ Vague error handling ("handle errors properly")
- ❌ No edge cases mentioned (need at least 2)
- ❌ Jumping to distributed systems (junior = CRUD first)
- ❌ Unclear pronouns ("it should do this")

---

## 📈 Weekly Review Checklist

**Every Sunday, review your week:**

- [ ] Count: How many questions attempted?
- [ ] Average score this week: ___/5
- [ ] Which block(s) did I consistently miss?
- [ ] Am I improving on time management? (trending under 60s?)
- [ ] Did I master any question (3x 5/5)? Which one?
- [ ] Update QUESTION-TRACKER.md dashboard
- [ ] Update gaps.md with progress
- [ ] Plan next week: Which gap to focus on?

**Goal:** Clear progress visibility + adjusted focus for next week

---

## 🎓 The 3 Gaps & How to Fix Them

### Gap 1: Structural Communication
**Problem:** Ideas strong but poorly layered  
**Fix:** Use 5-block framework explicitly in every answer  
**Practice:** Q1.1, Q1.2, Q2.1

### Gap 2: Over-Abstraction  
**Problem:** Jumping to advanced patterns for junior questions  
**Fix:** Start with clean CRUD, add complexity only when asked  
**Practice:** Q1.4, Q1.5, Q2.2

### Gap 3: Code Articulation  
**Problem:** Weak live coding structure under pressure  
**Fix:** Timed builds (45 min), rebuild without reference  
**Practice:** Q3.1, Q3.2, Q3.3

---

## 🌏 Market-Specific Quick Tips

### 🇸🇬 Singapore
- Mention transactions explicitly for multi-table writes
- Use idempotency-key for payment/order operations
- Keep answers structured, under 60s
- Label layers clearly

### 🇻🇳 Vietnam
- Show framework knowledge (Express/NestJS/Spring)
- Include DTO validation code
- Provide concrete examples over theory
- Mention real-world integrations

### 🇹🇭 Thailand
- Practical problem-solving focus
- Clear error responses
- Simple language, avoid jargon

### 🇲🇾 Malaysia
- Balanced approach (theory + practice)
- Clean code examples
- Professional English

### 🇮🇩 Indonesia
- Focus on working implementations
- Clear communication
- Practical use cases

---

## ✅ Am I Interview Ready?

**Self-Check (Answer honestly):**

- [ ] Can recite 5-block framework from memory?
- [ ] Have 10+ questions mastered (5/5 score)?
- [ ] Consistently answer in under 60 seconds?
- [ ] All answers have all 5 blocks identifiable?
- [ ] Can rebuild features from scratch without reference?
- [ ] Know market-specific expectations for target region?
- [ ] Completed at least 2 mock interviews with scoring?
- [ ] Identified and addressed red flags from RESPONSE-EVALUATION-FRAMEWORK.md?

**If 7/8 are ✅ → You're ready!**  
**If 4-6 are ✅ → Keep practicing, you're close**  
**If < 4 are ✅ → Follow QUICKSTART.md + WORKFLOW.md Week 1-2**

---

## 🚨 When Stuck, Use This Decision Tree

```
Stuck?
  │
  ├─ "Don't know where to start"
  │   └→ Go to README.md → QUICKSTART.md Day 1
  │
  ├─ "Don't know what to practice today"
  │   └→ Open QUESTION-TRACKER.md → Pick lowest scoring question
  │
  ├─ "My answer doesn't feel right"
  │   └→ Compare to interview-preparation.md examples
  │
  ├─ "Don't know how to score myself"
  │   └→ Use RESPONSE-EVALUATION-FRAMEWORK.md rubric
  │
  ├─ "Not sure if I'm improving"
  │   └→ Check QUESTION-TRACKER.md dashboard + weekly review
  │
  ├─ "Don't understand market expectations"
  │   └→ Read gaps.md + recruiter-enforced.md for target region
  │
  └─ "System is confusing"
      └→ Read STRUCTURE.md to see how files connect
```

---

## 💡 Pro Tips

1. **Copy template first thing** - Start every session by copying daily-compression-template.md
2. **Time yourself always** - Use phone timer for 60s (verbal) or 45min (code)
3. **Speak answers out loud** - Even if writing, verbalize to check flow
4. **Practice same question 2-3 times** - Space attempts 2-3 days apart
5. **Update tracker immediately** - Don't wait, log attempt while fresh
6. **Review examples between attempts** - Learn from interview-preparation.md
7. **Weekly reviews are critical** - Pattern recognition happens here
8. **Start simple** - Resist urge to over-engineer junior questions
9. **Label blocks explicitly** - "For validation, I would..." makes it clear
10. **Focus on one gap at a time** - Don't try to fix everything at once

---

## 📞 Quick Commands

### Start Practice Session
```bash
# Copy template
cp daily-compression-template.md daily-$(date +%Y%m%d).md

# Open tracker + template
open QUESTION-TRACKER.md
open daily-$(date +%Y%m%d).md
```

### After Practice Session
```bash
# Open files to update
open QUESTION-TRACKER.md  # Update attempt table
open gaps.md              # If gap progress noted
```

### Weekly Review
```bash
# View all practice files from week
ls -la daily-202603*.md

# Open review files
open QUESTION-TRACKER.md  # Update dashboard
open WORKFLOW.md          # Check weekly review checklist
open gaps.md              # Update progress
```

---

## 🎯 Success Metrics Snapshot

| Timeframe | Expected Progress |
|-----------|-------------------|
| **Week 1** | 7 daily sessions, 5-block framework mastered, 3 questions attempted |
| **Week 2** | 7 daily sessions, 5+ questions attempted, 2+ questions mastered |
| **Week 3** | 7 daily sessions, 10+ total questions attempted, 5+ mastered |
| **Week 4** | 2 mock interviews, 15+ questions attempted, 10+ mastered |

**Overall Goal:** 20+ practice sessions, 10+ mastered questions, 1+ gap significantly improved

---

## 🔖 Bookmark This Page

Save this file as your daily reference. Print it if helpful!

**File Location:** [QUICK-REFERENCE.md](QUICK-REFERENCE.md)

---

**Ready to start? → Go to [QUICKSTART.md](QUICKSTART.md) Day 1**
