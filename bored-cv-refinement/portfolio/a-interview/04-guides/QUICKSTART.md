# Quick Start Guide: Your First 7 Days

**Goal:** Get interview-ready foundations in place while understanding how all materials work together.

**Time Investment:** ~45-60 minutes daily

**Expected Outcome:** Clear understanding of your gaps + foundation in the 5-block framework

---

## The Big Picture

You have 4 core documents:

1. **WORKFLOW.md** ← Overall strategy & phases (read first)
2. **interview-preparation.md** ← Example questions with ideal answers
3. **recruiter-enforced.md** ← How recruiters will evaluate you
4. **daily-compression-template.md** ← Daily practice template

**How they work together:**
```
WORKFLOW (strategy) → daily-compression-template (daily practice) 
→ interview-preparation (learn examples) → recruiter-enforced (understand scoring)
```

---

## Day 1: Foundation Setup (60 min)

### Morning (20 min): Understand the Framework

1. **Read:** [WORKFLOW.md - Gap Snapshot section](WORKFLOW.md#gap-snapshot) (5 min)
2. **Read:** [WORKFLOW.md - Quick Reference: 5-Block Framework](WORKFLOW.md#quick-reference-5-block-framework) (5 min)
3. **Memorize:** Validation → Service → Persistence → External → Failure (5 min)
4. **Write down:** One-sentence definition of each block (5 min)

**Deliverable:** You can recite the 5 blocks in order from memory

### Evening (40 min): First Practice Answer

1. **Open:** daily-compression-template.md
2. **Copy** the entire template to a new file: `daily-20260303.md`
3. **Pick one question:** Q1 from [interview-preparation.md - Question Set 1](interview-preparation.md#question-set-1-order-processing-api)
   - Question: "Design a POST /orders endpoint for an e-commerce system"
4. **Use template:**
   - Framework Review (5 min)
   - Today's Focus (5 min) - paste the Q1 question
   - Build/Respond (20 min) - write your answer (don't look at the guide yet)
   - Unpack (5 min) - answer the reflection questions
   - Self-Assessment (3 min) - rate yourself on the criteria
   - Skip Stretch Goal for now
   - Learning Log (2 min) - what did you notice?

**Deliverable:** One completed daily template + your first recorded answer

---

## Day 2: Learn from Examples (60 min)

### Morning (20 min): Study Ideal Answers

1. **Read:** [interview-preparation.md - Q1 Ideal Response](interview-preparation.md#ideal-response-structure) (10 min)
   - Note the 5 blocks explicitly labeled
   - Notice the structure and flow
2. **Read:** [interview-preparation.md - Q1 Practice Response](interview-preparation.md#practice-response-60-seconds-max) (5 min)
   - Time yourself reading it - takes ~50 seconds
   - This is your 60-second target length
3. **Compare:** Your Day 1 answer vs. the guide's answer (5 min)
   - Did you use all 5 blocks?
   - Was yours clearer or more confusing?
   - What would you change?

**Key Insight:** The guide answer explicitly says "Validation block:" - you don't need to be this formal, but you DO need to be clear about layers.

### Evening (40 min): Redo Q1 with Improvements

1. **Copy:** daily-compression-template.md → `daily-20260304.md`
2. **Pick question:** Same as yesterday (Q1)
3. **Fill template:**
   - Framework Review (5 min)
   - Today's Focus (5 min)
   - Build/Respond (20 min) - give it another shot, use yesterday's feedback
   - Unpack (5 min)
   - Self-Assessment (3 min) - compare to Day 1
   - Learning Log (2 min)

**Success Metric:** 
- Day 1 answer = maybe 3-4 blocks clear
- Day 2 answer = all 5 blocks, better articulation

---

## Day 3: Understand How You'll Be Evaluated (60 min)

### Morning (30 min): Recruiter Expectations

1. **Pick your target market:** Singapore (most demanding, good baseline)
2. **Read:** [recruiter-enforced.md - Singapore evaluation](recruiter-enforced.md#singapore--structured--transactional) (10 min)
3. **Look at scoring rubric:** [recruiter-enforced.md - Scoring Rubric](recruiter-enforced.md#scoring-rubric-per-question) (5 min)
4. **Re-read your Day 2 answer** with SG expectations in mind (10 min)
   - Did you mention transactions? (SG cares!)
   - Was it structured clearly? (SG cares!)
   - Did you separate HTTP from business logic? (SG cares!)
   - Time was under 90s? (SG cares!)

### Evening (30 min): Second Recruiter Market

1. **Pick a different market:** Vietnam (more pragmatic)
2. **Read:** [recruiter-enforced.md - Vietnam evaluation](recruiter-enforced.md#vietnam--practical--pragmatic) (10 min)
3. **Compare:** Singapore vs. Vietnam expectations
   - Singapore wants: Structure, transactions, precise English
   - Vietnam wants: Practical examples, external API awareness, speed
4. **Reframe your Day 2 answer for Vietnam:**
   - Would they find it too theoretical?
   - Would they want more practical implementation details?
   - Would they prefer faster/simpler?

**Key Insight:** Same answer, different markets = different scores. You'll need regional versions.

---

## Day 4: Code Fundamentals (60 min)

### Morning (20 min): Review Code Example

1. **Read:** [interview-preparation.md - Q4: User Registration API](interview-preparation.md#q4-build-a-user-registration-api) (10 min)
   - Note the "Strong Junior Answer" section
   - This is the level to target
2. **Read:** [interview-preparation.md - Q5: Password Reset](interview-preparation.md#q5-implement-password-reset) (5 min)
   - Start simple, show edge cases, mention complexity only if asked
3. **Key principle:** Junior-first positioning

### Evening (40 min): Code Your Own Simple API

1. **Copy:** daily-compression-template.md → `daily-20260307.md`
2. **Pick question:** "Build a simple user registration endpoint"
3. **Code (in your language):**
   ```
   Requirements:
   - POST /users with email, password
   - Validate email format
   - Validate password strength (8+ chars, 1 number)
   - Check if email already exists
   - Hash password
   - Return 201 with user ID
   
   Time limit: 25 minutes
   ```
4. **Fill template:**
   - Framework Review (5 min)
   - Today's Focus (5 min)
   - Build/Respond (25 min) - write actual code
   - Unpack (5 min)
   - Self-Assessment (3 min)
   - Learning Log (2 min)

**Success Metric:** Working code with clear error handling, completed in time

---

## Day 5: Weekly Code Build (60 min)

### Full Session: Timed API Build

From [WORKFLOW.md - Daily Task Compression](WORKFLOW.md#daily-task-compression):

**This is your Friday timed build.** Set a timer for 45 minutes.

```
CHALLENGE:
Build a complete POST /orders endpoint with:
- Request validation (items exist, user authenticated)
- Create order record
- Update inventory (transaction)
- Call payment processor
- Error handling (at least 2 failure modes)
- Response with created order

Time limit: 45 minutes
No reference materials allowed
```

**Use the template** but extend it:
- Framework Review (5 min)
- Today's Focus (5 min)
- Build/Respond (45 min)
- Unpack (10 min) - extra time because this is bigger
- Self-Assessment (5 min)
- Learning Log (2 min)

**Key Metric:** Can you write clean code under time pressure?

---

## Day 6: Rebuild Without Reference (60 min)

### Full Session: Same API, No Cheating

Build the **same API from Day 5** but from memory.

```
You have 45 minutes.
You cannot look at your Day 5 code.
Build as close as possible to yesterday's version.
```

**Why?** Ensures you understand, not just copy-pasted.

**Use the template** and compare results:
- Did you remember the structure?
- Did you include all error handling?
- Was it cleaner or messier?
- What did you forget?

---

## Day 7: Review & Plan Week 2 (60 min)

### Morning (30 min): Consolidate Learning

1. **Gather all 6 daily templates** from Days 1-6
2. **Fill in a Weekly Summary:**

```markdown
## Week 1 Review

### Strengths
- [What did you do well?]
- [Which blocks are you good at?]
- [What's your strongest answer?]

### Gaps
- [Which block is weakest?]
- [Which question was hardest?]
- [What took longest?]

### Progress
- Day 1 blocks present: X/5
- Day 6 blocks present: Y/5
- Improvement: Y-X blocks

### Market Readiness
- Singapore: [% ready - based on recruiter-enforced rubric]
- Vietnam: [% ready]
- Best market: [Which are you strongest for?]
```

### Afternoon (30 min): Plan Week 2

1. **Identify your weakest block:**
   - Monday-Wednesday: Focus drills on this block
2. **Pick market to specialize in:**
   - Thursday-Friday: Answer questions for this market
3. **Code project:**
   - Friday-Saturday: Choose either Password Reset or Inventory Management

**Use [WORKFLOW.md - Weekly Review Checklist](WORKFLOW.md#weekly-review-checklist) to guide your planning**

---

## What You've Accomplished in 7 Days

✅ Understood the 5-block framework  
✅ Practiced system design questions 3 times  
✅ Understood how you'll be evaluated  
✅ Studied market-specific expectations (SG + VN)  
✅ Wrote and shipped working code  
✅ Practiced code from memory  
✅ Created a learning feedback loop  

**You are now:**
- ✅ Familiar with the preparation system
- ✅ Clear on your gaps (see Day 7 summary)
- ✅ Ready to move to Weeks 2-3 specialization
- ✅ Set up for sustainable daily practice

---

## Week 2+: What's Next

From [WORKFLOW.md - Interview Preparation Tracks](WORKFLOW.md#interview-preparation-tracks):

### Week 2-3: Choose Your Track

**Track A: Deepen Communication**
- Master all 3 questions from Question Set 1
- Record yourself, review for clarity
- Practice under pressure (time yourself)

**Track B: Code Mastery**
- Complete Password Reset API (Day 7 deliverable)
- Rebuild without reference
- Record code walkthrough

**Track C: Market Specialization**
- Pick Singapore, Vietnam, or EU
- Answer 3 market-specific questions
- Get feedback from recruiter-enforced criteria

**Most effective:** Combine all three
- Monday-Tuesday: Communication (Q2-Q3 from guide)
- Wednesday: Code (Password Reset project)
- Thursday: Market specialization
- Friday: Full timed API
- Saturday-Sunday: Review + capture learning

---

## How to Use This Beyond Week 1

1. **Keep the daily-compression-template.md handy**
   - Copy it for every day you practice
   - Name it `daily-[DATE].md`
   - Save in a folder: `/learning/dailies/`

2. **Build your answer bank**
   - Collect your best answers each week
   - Organize by market and question type
   - Review before mock interviews

3. **Track progress**
   - Week 1: Understand framework
   - Week 2: Fluent in blocks
   - Week 3: Market specialization
   - Week 4+: Mock interviews ready

4. **Reference recruiter-enforced.md during practice**
   - Use the feedback template
   - Score yourself like a recruiter would
   - Identify specific improvements

---

## Quick Reference: Files & Their Purpose

| File | Purpose | When to Use |
|------|---------|-------------|
| **WORKFLOW.md** | Big picture strategy | When lost or confused about direction |
| **interview-preparation.md** | Learn from examples | When studying what a good answer looks like |
| **recruiter-enforced.md** | Understand scoring | When evaluating your own answer |
| **daily-compression-template.md** | Daily practice | Every single day you practice |
| **gaps.md** | Understand your gaps | To remember why you're practicing |

---

## Success Metrics

### By End of Week 1
- [ ] Can recite 5-block framework from memory
- [ ] Have completed 6 daily practice sessions
- [ ] Written 2 working APIs
- [ ] Understand SG + VN market expectations

### By End of Week 2
- [ ] Can deliver structured answer in <60 seconds
- [ ] Scored 4-5 blocks on most questions
- [ ] Completed 3 code projects
- [ ] Identified your weakest block

### By End of Week 3
- [ ] Can deliver 3+ different answers fluently
- [ ] Scored 5/5 blocks consistently
- [ ] Can rebuild any API from memory
- [ ] Ready for first mock interview

### By End of Week 4+
- [ ] Completed 2 mock interviews with recruiter agent
- [ ] Market-specific answers ready (for target region)
- [ ] Comfortable with surprises/follow-ups
- [ ] Interview-ready for target companies

---

## If You Have Questions

Refer back to the documents in this order:

1. **"I'm confused about the overall plan"** → WORKFLOW.md
2. **"What's a good answer look like?"** → interview-preparation.md
3. **"How will I be graded?"** → recruiter-enforced.md
4. **"What should I practice today?"** → daily-compression-template.md
5. **"Why am I working on this?"** → gaps.md

---

## Day 1 Immediate Action Plan (Right Now)

⏰ **If you have 15 minutes:**
1. Memorize the 5 blocks
2. Read WORKFLOW.md gap snapshot
3. Write down your first question

⏰ **If you have 30 minutes:**
1. Memorize the 5 blocks
2. Read WORKFLOW.md gap snapshot
3. Skim interview-preparation.md Q1
4. Copy daily-compression-template.md
5. Start filling it out

⏰ **If you have 60 minutes:**
1. Do everything above
2. Complete your first daily template
3. Record your Q1 answer (audio or video)
4. Review against the guide's answer
5. Plan tomorrow's session

---

## Motivation

You identified 3 specific gaps. This system is designed to close them in 4 weeks through:

1. **Daily structured practice** (45-60 min) - Builds fluency
2. **Feedback loops** (daily template) - Ensures improvement
3. **Market awareness** (recruiter rules) - Targets hiring criteria
4. **Measurable progress** (weekly review) - Motivates continuation

By the end of this, you will be interview-ready for junior backend roles in your target markets. The work is intentional, focused, and proven to work.

**Let's go. Start with Day 1.**

