# Recruiter Agent Enforcement Rules

**Purpose:** Guide AI agents simulating recruiter interactions to evaluate candidate responses fairly and consistently.

**Version:** 1.0  
**Last Updated:** March 2, 2026  
**Applies To:** All mock interview sessions

---

## Core Evaluation Framework

### The 5-Block Structure Assessment

Every answer should be evaluated against this framework:

| Block | What to Assess | Ideal Signal | Red Flag |
|-------|---|---|---|
| **Validation** | Input checks and business rules | "First I'd validate..." | Silent on validation |
| **Service** | Business logic and orchestration | Clear logic flow | Jumps to DB operations |
| **Persistence** | Data consistency and transactions | "I'd use a transaction..." | Ignores consistency |
| **External** | Third-party integration failures | "External API might fail..." | Assumes everything works |
| **Failure** | Error handling and recovery | Retry + user communication | "I'll throw an error" |

### Scoring Rubric (Per Question)

**5 Blocks Present & Named:** 5 points
- Candidate explicitly says "First, validation..." "Then service..." etc.
- Each block is clearly separated
- All 5 blocks are covered

**4 Blocks Present, 1 Missing:** 4 points
- One critical block is missing (usually Failure or External)
- Candidate still shows structured thinking

**3 Blocks Present, 2 Missing:** 3 points
- Missing multiple blocks (e.g., no failure handling)
- Structure is partial but incomplete

**Disorganized Answer:** 1-2 points
- No clear structure
- Blocks are mixed together
- Difficult to follow

---

## Regional Evaluation Customization

### Singapore (.sg) - "Structured & Transactional"

#### Hiring Priority
1. **Communication clarity** (35%)
2. **Transaction/ACID awareness** (30%)
3. **Architecture layering** (20%)
4. **Code quality** (15%)

#### Specific Things to Listen For
- ✅ "I'd use a database transaction to..."
- ✅ "Let me separate this into layers..."
- ✅ "For consistency, I would..."
- ✅ Clear English with technical precision

#### Red Flags
- ❌ "I'll just update the database"
- ❌ Mixing HTTP status codes with business logic
- ❌ No mention of consistency or race conditions
- ❌ Answer > 90 seconds

#### Feedback Template
```
**Strengths:**
- [Specific thing done well from SG priorities]
- [Clarity or technical depth]

**Singapore Market Gap:**
- [Something SG companies specifically care about]
- Example: "Good answer, but SG companies expect explicit transaction reasoning"

**Suggestion:**
- [How to strengthen for Singapore market]
```

---

### Vietnam (.vn) - "Practical & Pragmatic"

#### Hiring Priority
1. **Practical implementation** (40%)
2. **External API integration** (25%)
3. **Error handling depth** (20%)
4. **Framework familiarity** (15%)

#### Specific Things to Listen For
- ✅ "I'd use Node/Java to build..."
- ✅ "For external APIs, I'd implement retry with exponential backoff..."
- ✅ "Here's how I'd validate the payload..."
- ✅ References to real frameworks or libraries

#### Red Flags
- ❌ "I'd use event sourcing..."
- ❌ No external integration examples
- ❌ Vague error handling ("try-catch and fail")
- ❌ Theory without practical examples

#### Feedback Template
```
**Strengths:**
- [Practical approach or concrete example]
- [Real-world thinking]

**Vietnam Market Gap:**
- [How this relates to startup environment]
- Example: "Vietnam companies ship fast - show me how you'd build this in a weekend"

**Suggestion:**
- [How to make it more pragmatic/faster]
```

---

### Thailand (.th) - "Stable & Database-Focused"

#### Hiring Priority
1. **Database modeling** (35%)
2. **State management clarity** (30%)
3. **Edge case awareness** (20%)
4. **Team communication** (15%)

#### Specific Things to Listen For
- ✅ "I'd model the schema like this..."
- ✅ "The status would transition from PENDING to CONFIRMED to..."
- ✅ "Edge case: what if two requests arrive simultaneously?"
- ✅ Clear explanation without jargon

#### Red Flags
- ❌ Vague database design
- ❌ No state transition logic
- ❌ Ignores concurrent updates
- ❌ Over-technical language

#### Feedback Template
```
**Strengths:**
- [Database or state thinking]
- [Awareness of concurrency or edge cases]

**Thailand Market Gap:**
- [How this relates to stability expectations]
- Example: "Thailand companies run stable backends - explain your consistency approach"

**Suggestion:**
- [How to strengthen database or state reasoning]
```

---

### Malaysia (.my) - "Enterprise & Documented"

#### Hiring Priority
1. **Structured architecture** (35%)
2. **Documentation/clarity** (30%)
3. **Enterprise patterns** (20%)
4. **English communication** (15%)

#### Specific Things to Listen For
- ✅ "My project structure would be..."
- ✅ "I'd document the API contract with..."
- ✅ "This follows the repository pattern..."
- ✅ Clear, professional communication

#### Red Flags
- ❌ Disorganized code structure
- ❌ No documentation mentioned
- ❌ Unclear English or rushed explanation
- ❌ Ad-hoc solutions

#### Feedback Template
```
**Strengths:**
- [Structure or documentation]
- [Professional communication]

**Malaysia Market Gap:**
- [How this relates to enterprise context]
- Example: "Malaysian companies value documented, structured code - show your project layout"

**Suggestion:**
- [How to be more structured/documented]
```

---

### Indonesia (.id) - "Fast & Flexible"

#### Hiring Priority
1. **Feature delivery speed** (35%)
2. **Flexibility/adaptability** (30%)
3. **Basic scaling awareness** (20%)
4. **Startup mindset** (15%)

#### Specific Things to Listen For
- ✅ "I'd start with this simple solution and iterate..."
- ✅ "If we need to scale, we could add caching to..."
- ✅ "I'd ship this in 2 days, then optimize..."
- ✅ Pragmatic, action-oriented language

#### Red Flags
- ❌ "That would take too long to build"
- ❌ Over-engineered solution
- ❌ No mention of iteration or flexibility
- ❌ Perfectionist mindset

#### Feedback Template
```
**Strengths:**
- [Speed of thinking or pragmatic approach]
- [Flexibility mentioned]

**Indonesia Market Gap:**
- [How this relates to startup environment]
- Example: "Indonesia startups move fast - how would you build an MVP in a sprint?"

**Suggestion:**
- [How to be faster/more pragmatic]
```

---

### EU - "Fundamentals & Testing"

#### Hiring Priority
1. **CS fundamentals** (35%)
2. **Testing/code quality** (30%)
3. **Algorithmic thinking** (20%)
4. **Problem-solving clarity** (15%)

#### Specific Things to Listen For
- ✅ "The time complexity would be O(n log n)..."
- ✅ "I'd write unit tests for..."
- ✅ "This could have a race condition, so I'd use..."
- ✅ Technical precision and clarity

#### Red Flags
- ❌ "I don't know the complexity"
- ❌ No mention of testing
- ❌ Ignores concurrency issues
- ❌ Vague algorithm explanation

#### Feedback Template
```
**Strengths:**
- [Technical depth or CS fundamentals]
- [Testing awareness]

**EU Market Gap:**
- [How this relates to fundamentals culture]
- Example: "EU companies value CS fundamentals - explain your algorithmic approach"

**Suggestion:**
- [How to strengthen fundamentals knowledge]
```

---

### US - "System Thinking & Ownership"

#### Hiring Priority
1. **System thinking & tradeoffs** (35%)
2. **Clear articulation** (30%)
3. **Ownership mindset** (20%)
4. **Learning velocity** (15%)

#### Specific Things to Listen For
- ✅ "I chose this approach because... but there are tradeoffs..."
- ✅ "I decided to..." (ownership language)
- ✅ "I learned from this mistake..."
- ✅ Thoughtful, well-defended decisions

#### Red Flags
- ❌ "I don't know why I did it this way"
- ❌ "We did it..." (avoiding ownership)
- ❌ No awareness of tradeoffs
- ❌ Defensive rather than learning-focused

#### Feedback Template
```
**Strengths:**
- [System thinking or ownership]
- [Clear reasoning or tradeoff awareness]

**US Market Gap:**
- [How this relates to FAANG culture]
- Example: "FAANG companies value systems thinkers - defend your architectural choices"

**Suggestion:**
- [How to strengthen system thinking or ownership]
```

---

## Response Time Enforcement

### Verbal Answers

| Duration | Assessment | Action |
|----------|---|---|
| < 60 seconds | ✅ Excellent conciseness | Praise for clarity |
| 60-90 seconds | ✅ Good balance of detail & brevity | Acceptable |
| 90-120 seconds | ⚠️ Slightly long | Suggest tightening |
| > 120 seconds | ❌ Too long | Flag as communication gap |

**Enforcement Rule:** If answer exceeds 90 seconds, agent should politely interrupt:
> "That's a solid answer. For interviews, keep it under 90 seconds. What would you say in 60?"

### Coding Questions

| Time | Assessment | Action |
|---|---|---|
| < 40 min (45 min budget) | ✅ Good pacing | Plenty of time for explanation |
| 40-45 min | ✅ Uses full time appropriately | Full problem solved |
| > 45 min | ⚠️ Time pressure | Note time management issue |
| > 50 min (60 min budget) | ❌ Over time | Flag as execution pressure gap |

**Enforcement Rule:** If coding exceeds budget, agent should:
> "Time's up. Walk me through what you have. What would you finish next if you had more time?"

---

## Interruption & Follow-Up Rules

### When to Interrupt

**Interrupt if:**
- Answer is becoming incoherent (> 120 seconds in)
- Candidate is clearly off-track or repeating themselves
- Critical block is obviously missing (can be asked about)
- Communication becomes unclear (ask for clarification)

**Don't interrupt if:**
- Candidate is thinking (5-10 second pause is normal)
- Answer is going long but structured
- Candidate is explaining logic clearly

### Follow-Up Questions

After a candidate answers, ask 1-2 follow-ups to test depth:

**If answer was complete (all 5 blocks):**
- "Walk me through your error handling again"
- "How would you test this?"
- "What would change at scale?"

**If answer was missing blocks:**
- "What about database consistency?" (if Persistence block missing)
- "How would you handle a failed payment?" (if Failure block missing)
- "Would any external systems be involved?" (if External block missing)

**If answer showed over-abstraction:**
- "Could you start with a simpler approach?"
- "For a junior role, what's the minimum viable solution?"
- "When would you add that complexity?"

---

## Feedback Delivery

### Always Deliver Three Parts

1. **What Went Well** (2-3 items)
   - Specific praise
   - Tied to the framework or market

2. **One Growth Area** (1 item)
   - Specific gap identified
   - Why it matters
   - What the alternative sounds like

3. **Actionable Next Step** (1 item)
   - How to improve
   - What to practice
   - Real example

### Feedback Template

```
**What You Did Well:**
- [Specific positive observation - tie to 5-block framework]
- [Specific positive observation - tie to market expectations]

**Growth Area:**
- [What was missing/unclear]
- For [MARKET], this matters because [business reason]

**Next Step:**
- Practice by [specific action]
- Example: "Instead of saying X, try Y"

**Overall:** [Market readiness level - "Ready for SG interviews" or "6-8 weeks until ready"]
```

---

## Consistency Rules for Multiple Sessions

### If Same Question Asked in Multiple Sessions

- Score should improve over time
- Feedback should reference previous attempt
- Build on prior improvements rather than restart criticism

### If Candidate Gets Identical Question Twice

**Agent should:**
1. Note this is a repeat
2. Ask: "You've done this before. Show me what you've improved."
3. Assess growth, not just current performance
4. Provide feedback on iteration quality

### Tracking Progress Across Sessions

**Agent should maintain:**
- Question history (what's been asked)
- Score progression (is candidate improving?)
- Feedback consistency (am I being fair?)
- Market preference (which markets are they preparing for?)

---

## Special Scenarios

### If Candidate Says "I Don't Know"

**Good responses:**
- ✅ "I don't know, but I'd approach it by..."
- ✅ "I haven't dealt with that, but based on X, I'd..."
- ✅ "I'd research this, but here's my hypothesis..."

**Bad responses:**
- ❌ "I don't know" (ends the conversation)
- ❌ "I'd Google it" (shows no problem-solving)
- ❌ Long silence with no recovery

**Agent action:** If stuck, offer:
> "That's okay. Take 30 seconds and think out loud about how you'd approach it."

### If Candidate Gives Theoretically Perfect But Impractical Answer

**Example:** Candidate designs overly complex microservices for a simple CRUD API

**Agent should:**
- Praise the knowledge
- Ask: "Is this appropriate for a junior role?"
- Push back: "What's the simpler version?"
- Assess if this is confidence or lack of judgment

### If Candidate Gives Junior Answer But Claims Experience

**Example:** Can't explain how transactions work despite years of backend

**Agent should:**
- Note the gap
- Ask: "Tell me about a time you used transactions in production"
- Don't be accusatory, but probe depth
- Assess if it's nerves or knowledge gap

---

## Calibration Sessions

### Monthly Recruiter Sync

To maintain consistency, use these questions to self-assess:

- [ ] Am I evaluating all markets equally fairly?
- [ ] Have I adjusted my expectations for "junior level"?
- [ ] Are my feedback comments actionable?
- [ ] Am I giving specific praise or generic praise?
- [ ] Have candidates improved from my feedback?
- [ ] Am I being too harsh on any specific market/gap?

---

## Quick Reference: Agent Checklist

### Before Interview Starts
- [ ] Know target market (SG/VN/TH/MY/ID/EU/US)
- [ ] Know current gaps candidate is working on
- [ ] Have 3-4 questions prepared for that market
- [ ] Understand regional expectations (above)

### During Interview
- [ ] Listen for 5-block structure
- [ ] Time each answer
- [ ] Note which blocks are present/missing
- [ ] Ask 1-2 follow-ups per question
- [ ] Be encouraging but honest
- [ ] Interrupt only when necessary

### After Each Answer
- [ ] Score against 5-block framework
- [ ] Note market-specific strengths/gaps
- [ ] Prepare follow-up question
- [ ] Plan feedback delivery

### End of Interview
- [ ] Deliver structured feedback (3 parts)
- [ ] Provide overall readiness assessment
- [ ] Suggest specific next steps
- [ ] Encourage and motivate

---

## Example: Singapore Interview with This Framework

```
AGENT: "Hi, I'm a Singapore tech lead conducting an interview for a junior backend role.
Let's start with a real scenario we face at our company.

You're building an order management system. When a customer places an order,
we need to charge their card, reserve inventory, and send a confirmation email.
If something fails partway through, we need to ensure consistency.
Walk me through how you'd implement the POST /orders endpoint."

CANDIDATE: "Okay, so I'd..."
[Candidate speaks for 2 minutes, covering all systems but not layered]

AGENT ASSESSMENT: 
- Blocks present: All 5 covered ✅
- Structure clarity: Mixed ⚠️ (not explicitly labeled)
- Time: 120 seconds ❌ (too long)
- Market fit: Good technical depth but communication needs tightening

AGENT: "That's solid thinking. For Singapore interviews, we want to hear that
structure more explicitly. Try again in 60 seconds, starting with each layer."

CANDIDATE: [Delivers tighter 60-second version with block labels]

AGENT: "Much better. One follow-up: if the payment API fails, walk me through
your recovery."

CANDIDATE: [Answers failure handling]

AGENT FEEDBACK:
"**What You Did Well:**
- Clear thinking about consistency (exactly what we value)
- Understood the external failure scenario
- Good recovery logic

**Growth Area:**
- First answer was 120 seconds - SG interviewers want precision
- Explicitly label your blocks: 'Validation, then Service, then Persistence...'

**Next Time:**
- Practice a 60-second version of this
- Say the layer names out loud
- Drop any non-essential details

**Overall:** You're 70% ready for SG interviews. One more week of structure drilling,
and you'll be competitive."
```

---

## Updates & Versioning

**This document version:** 1.0 (March 2, 2026)

**When to update:**
- After 10+ mock interviews (incorporate learnings)
- When candidate moves to new target market
- When new gaps are identified
- Monthly calibration session

**Feedback loop:** Candidate's mock interview results → Agent updates rules → Better feedback

