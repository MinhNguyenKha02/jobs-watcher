# Phase 2 Validation Gate (Lean)

**Purpose**: Manually validate reliability before Phase 3 features.

## ✅ Gate Checklist (Must Pass All)

### 2.3 Export Fixtures
- [x] Run: `npm run export-fixtures`
- [ ] Files created in tests/__fixtures__/:
  - failed-parses.json
  - parse-samples.json
  - export-stats.json
- [x] JSON parseable + stats present

### 2.4 End-to-End Webhook Test
- [x] Start: `npm run data-listening`
- [x] Send: `SEND_REAL_EMAIL=true npm run simulate-webhook`
- [x] MongoDB has:
  - raw_ingest +1
  - parse_log +2 (METADATA + JOB_DETAIL)
- [x] TUI popup appears

### 2.5 Stress + Memory Check
- [x] Run 10 sequential emails
- [x] raw_ingest count +10
- [x] parse_log count +20
- [ ] RSS memory < 100MB
- [x] No crashes / circuit breaker

## Gate Result
- ❌ **FAIL** → memory threshold exceeded (~173 MB RSS)
