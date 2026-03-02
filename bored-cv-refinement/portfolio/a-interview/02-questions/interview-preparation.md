# Junior Software Engineer Interview Preparation Guide

**Target Audience:** Junior Backend Engineer candidates applying to SEA (Singapore, Vietnam, Thailand, Malaysia, Indonesia) and global tech companies.

**Purpose:** Bridge the gap between conceptual understanding and clear, structured communication of backend engineering concepts.

---

## Table of Contents

1. [Gap 1: Structural Communication](#gap-1-structural-communication)
2. [Gap 2: Over-Abstraction](#gap-2-over-abstraction)
3. [Gap 3: Code Articulation](#gap-3-code-articulation)
4. [Self-Evaluation Checklist](#self-evaluation-checklist)
5. [Interview Practice Schedule](#interview-practice-schedule)

---

## Gap 1: Structural Communication

**Problem:** Ideas are strong but poorly layered. Mixing transport, business, and infrastructure concerns makes answers hard to follow.

**Recruiter Signal:** "Smart but hard to follow."

### The 5-Block Framework

Master this structure for all system design and API questions:

1. **Validation** - Input validation and business rule checking
2. **Service** - Business logic and orchestration
3. **Persistence** - Database operations and transactions
4. **External** - Third-party API calls and integrations
5. **Failure Handling** - Error states, retries, and recovery

---

### Question Set 1: Order Processing API

#### Q1: Design a POST /orders endpoint for an e-commerce system

**Ideal Response Structure:**

**Validation Block:**
"First, I validate the request. I check that the user is authenticated, the order items exist in our catalog, and the customer has inventory available."

**Service Block:**
"In the service layer, I calculate the total price, apply any applicable discounts, and create an order record with a PENDING status."

**Persistence Block:**
"I store the order in the database using a transaction. I update the inventory table to reserve items. If either operation fails, I rollback to maintain consistency."

**External Block:**
"Then I call the payment processor to charge the customer's card. This is external, so it might fail or timeout."

**Failure Handling Block:**
"If payment fails, I mark the order as PAYMENT_FAILED, release the reserved inventory, and return an error to the client. If the payment processor times out, I return a 202 status and notify the user via email that we're processing their payment asynchronously."

---

**Practice Response (60 seconds max):**

Deliver this response in under 60 seconds. Time yourself.

```
"I'd structure it in five layers. 

Validation: Check user auth, item availability, and inventory stock.

Service: Create the order, calculate totals, set status to PENDING.

Persistence: Use a database transaction to insert the order and update inventory atomically.

External: Call the payment API to charge the customer.

Failure Handling: If payment fails, mark order as PAYMENT_FAILED and release reserved inventory. If it times out, return 202 and send a confirmation email."
```

---

#### Q2: How would you handle a duplicate payment request?

**Ideal Response:**

"This is an idempotency problem. When a client retries after a timeout, I need to avoid charging twice.

**Validation:** I require a unique `idempotency-key` header in the request.

**Service:** Before processing, I check if a previous request with the same key succeeded. If yes, I return the original response.

**Persistence:** I store the idempotency key and response result in the database for 24 hours.

**External:** Payment processors like Stripe also support idempotent requests, so I'd pass the key to them as well.

**Failure Handling:** If we've already processed this key, return 200 with the cached result instead of retrying."

---

#### Q3: The payment API returns 500. What do you do?

**Ideal Response:**

"This is a transient external failure. I'd handle it this way:

**Validation:** Assume the request was valid; the problem is not client-side.

**Service:** Don't mark the order as failed immediately. Keep it as PENDING.

**Persistence:** Log the failed payment attempt with a timestamp.

**External:** Implement exponential backoff with jitter. Retry at 1s, 2s, 4s, up to 5 attempts.

**Failure Handling:** After 5 retries fail, mark the order as PAYMENT_PENDING_RETRY and notify the backend team. Send the customer an email: 'Your order is being processed. We'll confirm payment within the hour.'"

---

### Self-Evaluation: Structural Communication

After practicing these questions, answer these prompts:

- [ ] Can I explain the question in exactly 5 blocks?
- [ ] Do I mention the layer (Validation/Service/Persistence/External/Failure) before answering?
- [ ] Am I avoiding mixing concerns (e.g., not talking about HTTP status codes inside the persistence block)?
- [ ] Is my answer under 90 seconds?
- [ ] Can I repeat this answer without reference materials?

---

## Gap 2: Over-Abstraction

**Problem:** Jumping into distributed systems and over-engineering when junior-level questions ask for simplicity.

**Recruiter Signal:** "Thinks like mid-level but cannot show clean basics."

### The Junior Positioning Rule

**For junior interviews:**
1. **Show clean CRUD first** - Simple, working code
2. **Mention edge cases** - Prove you think about failure
3. **Only mention advanced patterns if asked** - Caching, async, scaling

---

### Question Set 2: CRUD + Edge Cases

#### Q4: Build a User registration API

**Naive Junior Answer (Bad):**
"I'd use event sourcing to capture all state transitions, publish events to Kafka for async processing, and use CQRS to separate read and write models..."

**Strong Junior Answer (Good):**

"Let me start simple:

**1. Accept POST /users with email and password**

**2. Validate:**
- Email format check
- Password strength check (minimum 8 chars, one number)
- Check if email already exists in database

**3. Hash the password using bcrypt**

**4. Insert into users table**

**5. Return 201 with user ID**

**Edge cases I'd handle:**
- Concurrent registration with same email: Use unique constraint on email column
- Password hashing timeout: Set a 5-second timeout for bcrypt
- Database connection failure: Return 503 Service Unavailable

**If performance becomes a bottleneck later, I'd add:**
- Email validation service (checking if the domain exists)
- Cache commonly used data
- But for now, this simple approach works and is testable."

This shows you can think like a junior (working solution) and a mid-level developer (you know when to optimize).

---

#### Q5: Implement password reset

**Strong Junior Answer:**

"Here's the flow:

**POST /password-reset/request**
- User submits email
- Validate email exists in database
- Generate a random 32-character token
- Store token with email and 1-hour expiration
- Send email with reset link (includes token)
- Return 200 (don't say if email exists for security)

**POST /password-reset/confirm**
- User submits new password and token
- Look up token in database
- Check it hasn't expired
- Validate new password strength
- Hash password with bcrypt
- Update user password
- Delete the used token
- Return 200

**Edge cases:**
- Token expires: Return 400 'Link expired, request a new one'
- Token used twice: Return 400 'Link already used'
- User changes email between reset request and confirm: Token becomes invalid (secure design)

**Not overcomplicating with:**
- No rate limiting on request endpoint (I'd add it if we saw abuse)
- No SMS confirmation (adding complexity not needed at junior level)
- No distributed token management (database is fine)"

---

### Self-Evaluation: Appropriate Scope

After practicing these questions:

- [ ] Can I implement the feature in simple terms first?
- [ ] Do I mention 2-3 edge cases?
- [ ] Do I avoid mentioning advanced patterns unless asked?
- [ ] Can someone implement my answer without asking clarifying questions?
- [ ] Do I know when to say "I'd optimize this later if needed"?

---

## Gap 3: Code Articulation Under Pressure

**Problem:** Weak live-coding structure and difficulty implementing under time pressure.

**Recruiter Signal:** "Understands system risk but execution unclear."

### Weekly Timed Challenge Structure

Each week, complete this 45-minute challenge:

1. **Setup (5 min):** Create a new folder, initialize project
2. **Build (30 min):** Implement the feature with:
   - Input validation and DTO
   - Business logic
   - Error handling
   - Database persistence
3. **Refactor (5 min):** Clean up code, add comments
4. **Review (5 min):** Check for obvious bugs

---

### Challenge 1: Simple Payment Charge Endpoint

**Requirements:**
```
POST /charges
- Accept amount (cents), currency, customer_id
- Validate amount > 0
- Check customer exists
- Create charge record (PENDING status)
- Call mock payment processor
- Update charge to SUCCESS or FAILED
- Return result with charge ID
```

**Expected Structure:**

```typescript
// 1. Types/DTOs
interface ChargeRequest {
  amount: number;
  currency: string;
  customerId: string;
}

interface ChargeResponse {
  chargeId: string;
  status: 'SUCCESS' | 'FAILED';
  amount: number;
}

// 2. Validation
function validateChargeRequest(req: ChargeRequest): string[] {
  const errors = [];
  if (!req.amount || req.amount <= 0) {
    errors.push("Amount must be greater than 0");
  }
  if (!['USD', 'SGD'].includes(req.currency)) {
    errors.push("Currency must be USD or SGD");
  }
  if (!req.customerId) {
    errors.push("Customer ID is required");
  }
  return errors;
}

// 3. Service
async function createCharge(request: ChargeRequest): Promise<ChargeResponse> {
  const errors = validateChargeRequest(request);
  if (errors.length > 0) {
    throw new BadRequestError(errors.join(', '));
  }
  
  const customer = await db.customers.findById(request.customerId);
  if (!customer) {
    throw new NotFoundError("Customer not found");
  }
  
  const charge = await db.charges.insert({
    customerId: request.customerId,
    amount: request.amount,
    currency: request.currency,
    status: 'PENDING'
  });
  
  try {
    await paymentProcessor.charge({
      chargeId: charge.id,
      amount: request.amount,
      customerId: request.customerId
    });
    
    await db.charges.update(charge.id, { status: 'SUCCESS' });
    
    return {
      chargeId: charge.id,
      status: 'SUCCESS',
      amount: request.amount
    };
  } catch (error) {
    await db.charges.update(charge.id, { status: 'FAILED' });
    throw new PaymentError("Payment processing failed");
  }
}

// 4. Controller
app.post('/charges', async (req, res) => {
  try {
    const result = await createCharge(req.body);
    res.status(201).json(result);
  } catch (error) {
    if (error instanceof BadRequestError) {
      res.status(400).json({ message: error.message });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ message: error.message });
    } else {
      res.status(500).json({ message: "Internal server error" });
    }
  }
});
```

---

### Articulation Checklist for Challenge 1

After building this, explain it in 3 minutes:

- [ ] "First, I define DTOs for type safety"
- [ ] "Then I validate input: amount > 0, currency supported, customer exists"
- [ ] "In the service, I create a PENDING charge record"
- [ ] "I call the payment processor"
- [ ] "If it succeeds, I mark the charge SUCCESS. If it fails, I mark it FAILED and throw an error"
- [ ] "The controller handles the error and returns appropriate HTTP status codes"

**Record yourself explaining this.** Listen back. If you're over 3 minutes, cut words.

---

### Challenge 2: Order Inventory Update

**Requirements:**
```
POST /orders
- Accept items: [{productId, quantity}]
- Validate product exists and stock is available
- Deduct inventory for each item (in a transaction)
- Create order record
- Return order with order ID

Handle:
- Product doesn't exist
- Insufficient inventory
- Partial order (some items in stock, some not)
```

---

### Challenge 3: Payment Webhook Handler

**Requirements:**
```
POST /webhooks/payment-status
- Accept webhook from payment processor: {chargeId, status, timestamp}
- Validate webhook signature for security
- Find the charge record
- Update status
- If failed, notify customer
- Return 200 to acknowledge

Handle:
- Duplicate webhook (same chargeId, same status)
- Webhook for unknown charge
- Invalid signature
```

---

### Self-Evaluation: Code Articulation

After completing one challenge:

- [ ] Did I complete it in 45 minutes?
- [ ] Can I explain it in under 3 minutes?
- [ ] Does it include input validation?
- [ ] Does it include error handling?
- [ ] Does it handle at least 2 edge cases?
- [ ] Could a mid-level engineer code-review this without questions?
- [ ] Do I avoid premature optimization (no caching/async unless needed)?

---

## Self-Evaluation Checklist

### After Each Interview Mock Session

Complete this checklist immediately after practicing 2-3 questions:

**Communication**
- [ ] Did I speak in 5 blocks (Validation → Service → Persistence → External → Failure)?
- [ ] Was my answer under 90 seconds?
- [ ] Did I avoid technical rambling?
- [ ] Did I mention specific technologies (database, library names) only when necessary?

**Technical Depth**
- [ ] Did I show clean CRUD implementation?
- [ ] Did I mention 2-3 edge cases?
- [ ] Did I avoid over-engineering?
- [ ] Did I explain my failure handling approach?

**Code Quality**
- [ ] Did I include input validation?
- [ ] Did I mention error types (BadRequest, NotFound, ServerError)?
- [ ] Did I explain transaction/atomic operation where needed?
- [ ] Did I think about idempotency for critical operations?

**Confidence**
- [ ] Did I pause and think before answering (not rambling)?
- [ ] Did I ask clarifying questions when the problem was ambiguous?
- [ ] Did I explain tradeoffs (simple vs. optimized)?
- [ ] Did I sound confident without being arrogant?

**HR Compatibility**
- [ ] Did I speak clearly and at a measured pace?
- [ ] Did I avoid filler words ("um," "like," "basically")?
- [ ] Did I show focus on backend engineering?
- [ ] Did I demonstrate a growth mindset ("I'd learn..." vs. "I know...")?

---

## Interview Practice Schedule

### Weekly Structure (60 minutes/day, 4 days/week)

**Monday: Structural Communication**
- Practice 2 system design questions using the 5-block framework
- Record yourself explaining your answer
- Spend 10 minutes reviewing clarity

**Tuesday: Live Coding Challenge**
- Complete one of the 3 challenges in 45 minutes
- Spend 15 minutes refactoring and explaining

**Wednesday: Edge Case Deepdive**
- Pick one past answer
- Brainstorm 5 additional edge cases
- Explain how to handle each
- Spend 20 minutes in this "question extension"

**Thursday: Mock Interview**
- Conduct a full 30-minute interview with yourself
- Ask 3-4 questions in random order
- Record and review

---

### Monthly Milestone

By the end of each month, you should be able to:

✅ Rebuild the Order + Payment system from scratch (no reference)
✅ Explain it in under 3 minutes
✅ Handle 5 edge cases when asked
✅ Code it live in 45 minutes with <3 bugs
✅ Defend every architectural decision

---

## Positioning Statement for Interviews

Use this when asked "Tell me about yourself" or "What's your backend focus?":

---

**"I focus on validation boundaries, clean service layering, and preventing inconsistent state during external integrations. In every feature I build, I separate concerns clearly—validation happens first, then business logic, then persistence, and finally external calls. I'm especially thoughtful about failure cases: what happens when a payment times out? When inventory is exhausted? I believe that junior backend engineers should master CRUD and edge cases before designing distributed systems."**

---

This positions you as:
- ✅ Focused (not all over the place)
- ✅ Thoughtful (not naïve about failure)
- ✅ Realistic about scope (junior-level confidence)
- ✅ Growth-oriented (learning the fundamentals deeply)

---

## Quick Reference: Common Q&A Patterns

### Q: "Design [Feature]"

**Structure:**
1. Clarify requirements (ask 2-3 questions)
2. Draw a diagram or list the main components
3. Walk through the happy path
4. Address 2-3 failure scenarios
5. Discuss one optimization (only if time allows)

### Q: "How would you fix [Problem]?"

**Structure:**
1. Validate I understand the problem
2. Break it into Validation / Service / Persistence / External / Failure Handling
3. Propose a solution
4. Explain tradeoff (speed vs. complexity)

### Q: "Write code for [Feature]"

**Structure:**
1. Start with types/DTOs (5 min)
2. Write validation (5 min)
3. Write business logic (10 min)
4. Add error handling (5 min)
5. Clean and review (5 min)

---

## Final Reminder: You're Targeting Junior-Level Roles

### What Interviewers Want to See

✅ **Clean implementation** of simple features
✅ **Awareness of failure cases** (you think like a mid-level dev)
✅ **Structured communication** (clear explanation, not brilliant rambling)
✅ **Testable code** (you mention unit testing)
✅ **Safe defaults** (you don't ship unsafe code)

### What Will Disqualify You

❌ Over-engineering every problem
❌ Explaining without coding
❌ Vague error handling ("if it fails, try again")
❌ No awareness of data consistency
❌ Defensive, arrogant tone

---

## How to Use This Document

1. **This week:** Master Gap 1 (Structural Communication)
   - Practice Q1, Q2, Q3 until you can answer without notes
   
2. **Next week:** Master Gap 2 (Over-Abstraction)
   - Practice Q4, Q5 and develop intuition for scope
   
3. **Week 3:** Master Gap 3 (Code Articulation)
   - Complete all three challenges
   - Record yourself explaining each
   
4. **Week 4 onward:** Mix and match
   - Practice 2 questions daily
   - Do 1 timed coding challenge per week
   - Record yourself weekly
   - Review recordings for clarity

**Goal:** By week 4, you should feel confident articulating backend engineering decisions under interview conditions.

---

**Last Updated:** March 2, 2026
**Target Markets:** Singapore, Vietnam, Thailand, Malaysia, Indonesia, EU, US
