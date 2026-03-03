# CI Micro-Plan: Local Long-Living Service

## Scope
- No beta release workflow.
- No deployment from CI.
- No auto-tagging in CI.
- Deterministic validation only.

## Gates
1. Build + unit/integration tests.
2. Fixture E2E with export to `src/db/e2e-output`.
3. Daily service checks (Gmail ingest + DB/log inspection).
4. Manual SemVer tagging only (`vX.Y.Z-beta.N`).
