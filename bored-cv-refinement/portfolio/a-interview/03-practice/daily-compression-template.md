# Daily Task Compression Template

Use this template every day to maximize learning in 45-60 minutes.

---

## SESSION: [DATE & TIME]

### 📋 Framework Review (5 min)

Before starting, lock in the framework:

```
Validation → Service → Persistence → External → Failure Handling
```

Quick check:
- [ ] Can I define each block in one sentence?
- [ ] Do I know what questions to ask for each block?

**Your 1-sentence definitions:**
1. **Validation:** [Write here]
2. **Service:** [Write here]
3. **Persistence:** [Write here]
4. **External:** [Write here]
5. **Failure:** [Write here]

---

### 🎯 Today's Focus (10 min)

**Question Selection:**
- [ ] From interview guide?
- [ ] From gaps analysis?
- [ ] From market-specific drill?
- [ ] Other: _______________

**Question:** [Paste here]

**Target Market:** [Choose: SG / VN / TH / MY / ID / EU / US]

**Success Criteria - I will:**
- [ ] Use the 5-block framework
- [ ] Stay under 60 seconds (verbal) or 45 min (code)
- [ ] Include 2+ edge cases
- [ ] Explain decisions clearly
- [ ] Sound confident, not rushed

---

### 💻 Build / Respond (25 min)

**[Your answer or code here - actual response with full context]**

```
[If coding: paste your actual implementation]
[If verbal: write out your response as if speaking]
```

**Time Taken:** ___ seconds / minutes

---

### 🔍 Unpack Your Decisions (10 min)

After completing your response, answer these questions:

**1. Why did you choose this approach?**
   [Answer here]

**2. What 2+ edge cases does it handle?**
   - Edge case 1: [What it is] → [How you handle it]
   - Edge case 2: [What it is] → [How you handle it]

**3. What would you improve at scale?**
   [Answer here]

**4. How does this fit [TARGET_MARKET] expectations?**
   [Answer here - use regional expectations from recruiter-enforced.md]

---

### ✅ Self-Assessment (5 min)

Rate yourself on each criterion:

| Criterion | Yes | Partial | No | Note |
|-----------|-----|---------|-----|------|
| **5-Block Framework Used** | ☐ | ☐ | ☐ | Which blocks present/missing? |
| **Under Time Limit** | ☐ | ☐ | ☐ | Actual time: ___ |
| **2+ Edge Cases** | ☐ | ☐ | ☐ | Which did you miss? |
| **Clear Error Handling** | ☐ | ☐ | ☐ | What failure modes exist? |
| **Market-Appropriate** | ☐ | ☐ | ☐ | Too simple/complex for [MARKET]? |

**Overall Score:** ___ / 5 blocks

---

### 🚀 Stretch Goal (5 min)

Pick one follow-up to deepen your thinking:

**Option 1 - Complexity:** If this works, how would it scale to 10x?  
**Option 2 - Edge Case:** What if [edge case]?  
**Option 3 - Alternative:** What's a different approach?  
**Option 4 - Tradeoff:** What would you sacrifice to make it faster?  

**My Stretch Goal:** [Choose and answer one]

---

### 📝 Learning Log (5 min)

**Key Insight from Today:**
[One sentence - what did you learn or realize?]

---

## What to Do With This Template

### Daily Ritual

1. **Copy this template** to a new file or notebook entry
2. **Fill in the date** at the top
3. **Go through each section** in order (don't skip)
4. **Be honest** in the assessment
5. **Save your response** for weekly review

### Weekly Review

Every Sunday, review all 7 daily templates:
- Count how many blocks you used consistently
- Identify patterns in what you're missing
- Assess time management trend
- Celebrate improvements from earlier in the week

### Sample Filled Template

```markdown
## SESSION: Monday, March 3, 2026 - 7pm

### 📋 Framework Review (5 min)
- [x] Can I define each block?
- [x] Do I know what questions to ask?

1. Validation: Check inputs against business rules
2. Service: Execute core business logic
3. Persistence: Store/retrieve data consistently
4. External: Handle third-party API calls
5. Failure: Recover from errors gracefully

### 🎯 Today's Focus (10 min)
- [x] From interview guide?
- [ ] From gaps analysis?
- [ ] From market-specific drill?

**Question:** Design a POST /orders endpoint

**Target Market:** SG

**Success Criteria:**
- [x] Use 5-block framework
- [x] Stay under 60 seconds
- [x] Include 2+ edge cases
- [x] Explain decisions clearly
- [x] Sound confident

### 💻 Build / Respond (25 min)

"I'd structure this in five layers.

Validation: Check user auth, confirm items exist, verify inventory available.

Service: Create order record, calculate totals with any discounts, set status to PENDING.

Persistence: Use database transaction - insert order and decrement inventory atomically. Rollback if either fails.

External: Call payment processor API to charge the card.

Failure: If payment fails, mark order PAYMENT_FAILED and restore inventory. If timeout, return 202 and notify customer via email that we're processing."

**Time Taken:** 52 seconds

### 🔍 Unpack (10 min)

1. Why this approach?
   - Transaction ensures inventory and order stay consistent
   - Async email handles payment timeout gracefully
   - Clear layering for SG market expectations

2. Edge cases?
   - Inventory oversold: Handled by decrement in transaction
   - Payment timeout: Return 202, notify async

3. Scale improvement?
   - Add queue for emails instead of sync
   - Add payment caching layer
   - Shard inventory data by region

4. SG market fit?
   - Good: Explicit transaction mention (key for SG)
   - Good: Clear layer separation
   - Good: Consistent thinking

### ✅ Self-Assessment (5 min)

| Criterion | Yes | Partial | No | Note |
|-----------|-----|---------|-----|------|
| 5-Block Framework | ✅ | | | All 5 present, labeled |
| Under Time | ✅ | | | 52 sec / 60 sec |
| 2+ Edge Cases | ✅ | | | Inventory + timeout |
| Error Handling | ✅ | | | Payment failure + timeout |
| Market-Appropriate | ✅ | | | Strong for SG (transaction focus) |

**Overall:** 5/5 blocks

### 🚀 Stretch Goal (5 min)

What if the payment processor fails 3 times?

**Answer:** 
- After 3 retries with exponential backoff (1s, 2s, 4s)
- Mark order as PAYMENT_RETRY_EXHAUSTED
- Notify support team
- Send customer email with manual payment link
- Keep order reserved for 24 hours

### 📝 Learning Log (5 min)

**Key Insight:** Explicitly naming each block out loud significantly improved clarity. Need to do this in all future answers. SG appreciates this level of structure.

---

## Next Session: [DATE]

**What to focus on:** Video record my answer to verify block labeling is clear
**Potential improvement:** Too much detail in Service block - trim to essentials
**Market to explore:** Vietnam for comparison
```

---

## Tips for Success with This Template

### ✅ DO:
- [ ] Fill it out **immediately** after attempting the question (within 5 minutes)
- [ ] Be **honest** in self-assessment (no bonus points for lying)
- [ ] **Record your answer** if possible (audio/video) to verify clarity
- [ ] **Reference** recruiter-enforced.md for market-specific feedback
- [ ] **Track your score** over time to see improvement

### ❌ DON'T:
- [ ] Skip the Framework Review (it's fast and primes your brain)
- [ ] Jump to the Stretch Goal (only if you have time)
- [ ] Copy answers from guides (you need to internalize, not memorize)
- [ ] Overthink the Learning Log (one sentence is enough)
- [ ] Compare your score to others (compare to your previous self)

---

## Weekly Pattern

Adapt this template based on what day it is:

| Day | Focus | Question Type |
|-----|-------|---|
| **Mon** | Communication | System design question |
| **Tue** | Communication | System design question |
| **Wed** | Code | Timed 20-min code challenge |
| **Thu** | Communication | Regional market-specific question |
| **Fri** | Code | Full 45-min API build |
| **Sat** | Code | Rebuild Friday's API without reference |
| **Sun** | Review | Pick weakest answer from week, redo it |

---

## Scoring Reference

### 5-Block Framework Score

- **5/5 blocks:** All blocks present, explicitly labeled, clear separation
- **4/5 blocks:** One block missing or implied (e.g., failure handling weak)
- **3/5 blocks:** Two blocks missing (e.g., skipped external or failure)
- **2/5 blocks:** Three or more blocks missing or confused
- **1/5 blocks:** Completely disorganized, no clear structure

### Time Management

- **Under budget:** Finished with time to spare → confidence signal
- **On budget:** Used 85-95% of time → well-paced
- **Slightly over:** Used 100-110% of time → rushed or over-explained
- **Significantly over:** Used 110%+ of time → communication needs work

### Edge Case Coverage

- **2+ edge cases:** Strong completeness
- **1 edge case:** Acceptable
- **0 edge cases:** Gap - junior role candidates should spot obvious failures

---

## Export & Share

After completing a week of these templates, you can:

1. **Extract key insights** into your answer bank
2. **Identify patterns** in what's working/not working
3. **Share with mentor/friend** for feedback
4. **Review before mock interviews** to remember what you learned

Example export:
```
WEEK 1 LEARNING:
- Consistently weak on Persistence block for SG market
- Need to practice explicit transaction language
- Time management improving (52→45 seconds)
- Vietnam market questions feel more natural than Singapore

NEXT WEEK FOCUS:
- 3x database transaction drills
- Build database schema first before API
- Try 2 Vietnam-focused questions to build confidence
```

---

## When to Use This Template

**Use DAILY for:**
- Single interview questions
- Communication practice
- Code walkthroughs
- Timed exercises

**Use WEEKLY for:**
- Full mock interviews (do this template after, not during)
- Video review sessions

**Archive MONTHLY:**
- Store completed templates in `/learning/` folder
- Review for pattern analysis
- Celebrate progress

---

## Quick Start: First Time Using This

**Right now (next 10 minutes):**

1. Pick one question from interview-preparation.md
2. Set a timer for 20 minutes
3. Answer the question (don't worry about being perfect)
4. Fill out this template from top to bottom
5. Count how many blocks you used
6. Save the file as `daily-[DATE].md`

**That's it.** You've completed one compression session. Do this every day for 7 days, and you'll see improvement.

