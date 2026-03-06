# SEA Question Quality & Trust Checklist

Use this checklist after each timed answer from `05-scripts/interview-simulation.sh`.

---

## 1) Market Target Lock (Required)

- [ ] I selected one target market before answering: `SG` or `VN`
- [ ] My answer explicitly reflected that market's hiring priorities
- [ ] I did not mix conflicting market styles in one response

Quick guide:

- **SG:** structured communication, transaction consistency, clear layering
- **VN:** practical implementation, external API handling, fast delivery tradeoffs

---

## 2) 5-Block Presence (Role Baseline)

Score `1` per block present and clear.

- [ ] Validation (input checks, auth, business constraints)
- [ ] Service (business flow, orchestration)
- [ ] Persistence (DB write/read, transaction or consistency)
- [ ] External (third-party integration behavior)
- [ ] Failure (retries, fallback, user-safe recovery)

**5-block score:** `___ / 5`

---

## 3) Trust & Safety Signals (Deterministic)

- [ ] Data correctness: no silent corruption risk
- [ ] Idempotency/concurrency risk addressed when applicable
- [ ] Auditability: logs/events/traces are mention-worthy
- [ ] User impact: failure path includes user-visible outcome
- [ ] Security/privacy basics acknowledged (tokens, PII, access)

**Trust score:** `___ / 5`

---

## 4) Time + State (From Script)

- [ ] State = `completed` or `timed_out`
- [ ] Answer length stayed interview-appropriate for target market
- [ ] If `timed_out`, I can identify what block was cut off

**Session state:** `completed / timed_out`

---

## 5) Reflection to Improve Next Attempt

Answer in 1-2 lines each:

1. What was strongest in this answer for my target market?
2. What quality gap reduced recruiter trust?
3. What one change will I apply in my next answer?

---

## Quick Final Score

Use a simple combined score:

- 5-Block Score: `___ / 5`
- Trust Score: `___ / 5`
- Final: `(5-Block + Trust) / 10 = ___ / 10`

Interpretation:

- `8-10`: interview-ready for current target market
- `6-7`: acceptable but needs focused refinement
- `<6`: re-practice same question before moving on
