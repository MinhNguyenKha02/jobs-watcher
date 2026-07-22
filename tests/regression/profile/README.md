# Retrieval Regression Corpus

Regression test suite that validates end-to-end pipeline behavior (retrieval → ranking → acceptance → ATS) against real-world JDs.

## Pipeline

```
relations.source.ts → artifact.builder.ts → 6 producers → generated/ artifacts → regression tests validate against expected/*.json
```

## Source Files

| File | Role | Lines | Description |
|------|------|-------|-------------|
| `relations.source.ts` | **Active canonical** | 8,578 | B variant — per-anchor dense `retrieval_associations` with FP-generic standalone terms stripped (250/1,820 entries removed) |
| `relations.source.copy.ts` | **Raw LLM backup** | 8,829 | Pre-curation original — same per-anchor structure but `retrieval_associations` contain ~30% FP-generic cross-category terms |

### Example: `foundationCapability.system_design`

| Field | `.ts` (B curated) | `.copy.ts` (raw) |
|-------|-------------------|------------------|
| `retrieval_associations` size | 11 | 16 |
| FP-generic terms | 0 | 5 (`architecture`, `scalability`, `modularity`, `performance`, `availability`) |

The `.copy.ts` provides the raw baseline before curation. The `.b.ts` intermediate file was produced by `scripts/curate-relations-source.py` before overwriting `.ts`.

## A/B Test Verdict

**B variant (current `relations.source.ts`) wins** — +48% precision, +111% recall, +73% F1 vs A. See [AB_TESTING.md](./AB_TESTING.md) for full results.

## Running

```bash
# Normal run (validate against expected/)
npm run test:jobIR:corpus

# Record mode (snapshot pipeline output to expected/)
RECORD=true npm run test:jobIR:corpus
```

## Coverage

- **Current**: 8 JDs (Indeed Vietnam, all entry-level)
- **Target**: 20-50 JDs across Backend, Platform/SRE, Data Engineering, Full Stack, AI/ML, Staff/Principal

## Relevant Scripts

- `scripts/curate-relations-source.py` — strips FP-generic standalone terms from `retrieval_associations`
- `scripts/evaluate-ab.py` — keyword heuristic ground truth + A/B metrics computation
