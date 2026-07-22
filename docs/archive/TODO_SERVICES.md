# Service start TODOs & decisions

- [x] Start webhook + run integration harness — attempted and services started (or attempted). See logs in `logs/` for details.

- [!] Add clearer non-interactive Gmail auth guard and pre-check (token.json)
  - Status: deferred / decision-skip
  - Reason: explicit design decision to avoid adding a non-interactive Gmail auth pre-check; interactive auth flows are intentionally not automated.

- [ ] Document decision to avoid non-interactive auth guard; operator must `source .env` before starting services
  - Created: 2026-03-16
  - Owner: operator
  - Notes: include steps to `source .env`, ensure `token.json` present if required, and how to run `npm run auth` when interactive auth is acceptable.
