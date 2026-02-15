# Profile Update for ATS Optimization

## Source Files Reviewed
- json.json
- json copy.json

## Decision
Use json.json (refined) as the canonical profile for Phase 3 drafting.

## ✅ Why json.json is Production-Ready
### 1) Defensibility (ScoredJob → Draft Trust)
**Impact on Draft Quality:**
- ✅ json.json → Draft will be credible ("I built Express APIs at Golive")
- ❌ json copy.json → Hiring manager: "Why claim NestJS if not shipped?"

### 2) ATS-Friendly + Human-Readable (Package Layer)
**json.json structure — why this works for Sender Layer:**
- ✅ ATS parseable: flat keywords (Go, TypeScript, PostgreSQL)
- ✅ Human-readable: hierarchy shows confidence level
- ✅ PDF-friendly: clean formatting, no CSS needed
- ✅ Email-safe: plain text renders correctly

**json copy.json structure — problems for Sender Layer:**
- ❌ Too many claims: 7 frameworks → HR filters out as "resume padding"
- ❌ No hierarchy: can’t distinguish solid vs learning
- ❌ Harder to tailor: Customizer doesn’t know which to highlight

## 🎯 Concrete Profile Version (json.json) for Drafting

## 🎯 Profile → ScoredJob → Draft Pipeline (Concrete)
**Input:** ScoredJob (from scoreMatcherEngine v0.5)
**Process:** ApplicationCustomizer.createDraft()
**Output:** Draft (trust-building, low-risk)

## ✅ Why This Profile Works for Phase 3 Sprints
### Sprint 1: Customizer (Draft Creation)
- ✅ Fundamentals are structured → easy to match against jobs
- ✅ Skill hierarchy (solid/familiar) → Customizer knows what to emphasize
- ✅ Shipped work clear → no guessing about production experience
- ✅ Projects map to tech stacks → reordering logic is straightforward

### Sprint 2: Template Editor (Rendering)
- ✅ Draft is clean JSON → Eta template rendering is simple
- ✅ No “inflated skills” to navigate → narrative flows naturally
- ✅ Section order already determined → template just formats

### Sprint 3: Document Generators (PDF/DOCX)
- ✅ Text is professional and honest → PDF styling enhances, doesn’t hide
- ✅ No CSS tricks needed → ATS-friendly formatting
- ✅ DOCX rendering is straightforward → clean structure

### Sprint 4: Sender (Email/LinkedIn)
- ✅ Package is defensible → higher response rate
- ✅ No red flags in profile → interviews go smoothly
- ✅ Honest narrative → trust-building from first touchpoint

## 🚀 Ready for Implementation
Use json.json as canonical profile.

**Next:** Implement Sprint 1.1 (Profile Parser) with this structure.

**Question:** Should we create `src/domain/profile-parser.ts` to parse this profile format?
