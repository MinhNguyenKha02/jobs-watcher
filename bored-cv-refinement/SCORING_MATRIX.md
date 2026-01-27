# Portfolio Scoring Matrix

## Overview
This document explains the 2D scoring matrix that evaluates your technical profile across capabilities and fundamentals.

## Matrix Axes

### X-Axis: Competency Types (2 categories)
1. **Capabilities** (direct technical skills)
   - Go, TypeScript, REST APIs, PostgreSQL, Docker, etc.
   - Each has: `level` (solid/working/familiar) + `domain` context
   
2. **Fundamentals** (foundational knowledge areas, hierarchical organization)
   - programming_languages, dsa, os, oop, database, networking, security, testing, ai
   - Each area contains multiple capabilities (lookup via `CapabilityToFundamental`)

### Y-Axis: Evidence Quality (proof backing each skill)
- Evidence types: `work`, `lab`
- Each evidence type has a credibility weight (EvidenceWeight)
- Higher weight = stronger proof of competency

## Hierarchical Data Structure

### CapabilityToFundamental (Fundamental → Capabilities[])
**Inverted mapping** for efficient aggregation:

```typescript
CapabilityToFundamental: Record<keyof Fundamentals, string[]> = {
  programming_languages: ["go", "typescript", "vue"],
  dsa: [],
  os: ["concurrency", "docker"],
  oop: [],
  database: ["postgres", "mongo"],
  networking: ["rest", "microservices", "tcpip", "http"],
  security: ["auth"],
  testing: ["ci"],
  ai: [],
}
```

**Advantages:**
- ✅ Direct iteration: `for each capability in FundamentalArea[x]`
- ✅ Type-safe: fundamental key must exist in FundamentalsSlices
- ✅ Efficient aggregation: no filter operations needed
- ✅ Easy maintenance: add/remove capability = update one array

### Helper Functions (Type-Safe Access)

```typescript
// Get all capabilities for a fundamental
getCapabilitiesForFundamental(fundamental: keyof Fundamentals): string[]

// Get fundamental for a capability (reverse lookup)
getFundamentalForCapability(capabilityId: string): keyof Fundamentals | undefined
```

## Scoring Formulas

### 1. Capability Score (Direct Skill Evaluation)

```
CapabilityScore = LevelStrength[level] × EvidenceWeight[evidenceType]
```

**Example: Go Language**
- Level: `solid` → LevelStrength = 1.0
- Evidence: `work` experience → EvidenceWeight = 1.0
- **Score = 1.0 × 1.0 = 1.0** (maximum)

**Example: Vue.js**
- Level: `familiar` → LevelStrength = 0.6
- Evidence: `lab` → EvidenceWeight = 0.76
- **Score = 0.6 × 0.76 = 0.456**

### 2. Fundamentals Score (Foundational Knowledge Evaluation)

```
FundamentalsScore[area] = FundamentalsSlices[area] × Σ(capabilities_in_area)
```

**Example: programming_languages**
- Weight: 0.24 (24% of fundamentals importance)
- Capabilities: Go (solid=1.0), TypeScript (solid=1.0), Vue (familiar=0.6)
- Sum: 1.0 + 1.0 + 0.6 = 2.6
- **Score = 0.24 × 2.6 = 0.624**

### 3. Profile Score (Overall Strength)

```
ProfileScore = {
  capabilityAverage: Σ(capability_scores) / count(capabilities)
  fundamentalsAverage: Σ(fundamentals_scores) / count(fundamentals)
  overallScore: (capabilityAverage + fundamentalsAverage) / 2
}
```

### 4. Aggregation Rules (Integrity-Preserving)

- Within a capability (multiple evidences possible): **use MAX**
  - `capability_final_score = max(all capability_score)`
  - Rationale: strongest proof wins; prevents stacking weak proofs to fake mastery.

- Within a fundamental area: **SUM of all capabilities**
  - `fundamental_score = Σ(capability_final_score) × FundamentalsSlices[area]`
  - Keeps skill truth (capability score) separate from market framing (fundamental weight).

### 5. Integrity Guarantees

- ✅ Transparency: every cell is `level × evidence` and every fundamental row is `Σ(capability_score) × weight`.
- ✅ Auditability: same inputs (raw data + constants) always yield the same scores.
- ✅ No self-inflation: you cannot boost scores without stronger evidence or higher levels.
- ✅ Recruiter-readable: mirrors how entry-level SWE portfolios are evaluated.
- ✅ Type-safe mappings: `CapabilityToFundamental` keys and `FundamentalsSlices` keys must align (validated on init).

## Matrix Visualization

```
                CAPABILITIES              FUNDAMENTALS
              ┌─────────────────────┬─────────────────────┐
              │ Go, TypeScript,    │ prog_langs, dsa,    │
              │ REST, Docker, etc. │ networking, etc.    │
            ┌───────┼─────────────────────┼─────────────────────┤
            │ work  │ score[cap][work]    │ score[fund][work]   │
            │       │ = 1.0 × 1.0 = 1.0   │ = 0.24 × 2.6        │
            ├───────┼─────────────────────┼─────────────────────┤
            │ lab   │ score[cap][lab]     │ score[fund][lab]    │
            │       │ = 0.7 × 0.76 = 0.532│ = 0.24 × 2.0        │
            └───────┴─────────────────────┴─────────────────────┘
```

## Weight Constants (Normalized)

### LevelStrength (Competency Depth)
- `solid`: 1.0 (expert level)
- `working`: 0.8 (professional use)
- `familiar`: 0.6 (foundational knowledge)

### EvidenceWeight (Proof Quality)
- `work`: 1.0 (production code)
- `lab`: 0.76 (lab/project/experiments)

### FundamentalsSlices (Area Importance, sum=1.0)
- programming_languages: 0.24
- dsa: 0.15
- oop: 0.13
- database: 0.15
- os: 0.10
- networking: 0.08
- security: 0.10
- testing: 0.05
- ai: 0.00 (optional)

## Type-Safe Validation Rules

✅ **On initialization:**
- `validateScoringRules()` checks:
  1. FundamentalsSlices weights sum to 1.0 (±0.001 tolerance)
  2. All fundamentals in CapabilityToFundamental match FundamentalsSlices keys
  3. No orphaned capabilities or fundamentals
  4. All capability IDs are registered in profile.capabilities

✅ **At compile time:**
- TypeScript ensures `Record<keyof Fundamentals, string[]>` type alignment
- EvidenceType must be "work" | "lab" (enforced by union type)
- Level must be "solid" | "working" | "familiar" (enforced by union type)

## Computing Your Portfolio Score

```typescript
// Direct hierarchical access:
const capabilities_for_networking = getCapabilitiesForFundamental("networking")
// Returns: ["rest", "microservices", "tcpip", "http"]

const scores = capabilities_for_networking.map(cap => getCapabilityScore(cap))
// Returns: [1.0, 0.8, 0.8, 0.8] (assuming all "working")

const networking_score = scores.reduce((s, sum) => s + sum, 0) * FundamentalsSlices.networking
// Returns: 3.2 × 0.08 = 0.256

// Or use helper:
const networking_score = getFundamentalScore("networking")
// Returns: 0.256
```

## Data Integrity Checks

✅ **Verified:**
- All Domain types align with capabilities
- All Level types match LevelStrength keys
- All EvidenceType values match EvidenceWeight keys
- FundamentalsSlices keys ⊂ Fundamentals interface keys
- CapabilityToFundamental keys = FundamentalsSlices keys
- Sum of weights is normalized (1.0)
- No circular imports or type mismatches

✅ **Consistency:**
- Each capability must have valid domain ∈ Domain
- Each capability must have valid level ∈ Level
- Each evidence must have valid type ∈ EvidenceType
- Each capability ID in CapabilityToFundamental must exist in profile.capabilities
- CapabilityPrimaryEvidence has entries for all mapped capabilities (fallback: "lab")

## Ready for Export

The data.ts file is now:
- ✅ Type-safe with hierarchical structure
- ✅ Self-consistent via validation rules
- ✅ Efficient for aggregation (no filtering)
- ✅ Easy to maintain (add capability = update array + CapabilityPrimaryEvidence)
- ✅ Computation-ready with helper functions
- ✅ Ready to package and deploy
