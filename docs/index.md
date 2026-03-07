# Docs Index

## E2E Runtime Exports

- Canonical directory: `src/db/e2e-output/`
- Integrity artifacts are consumed from this directory only.

## Core Docs

- [README.md](README.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DECISIONS.md](DECISIONS.md)
- [ENRICHMENT_FLOW.md](flows/ENRICHMENT_FLOW.md)
- [LONG_LIVING_EVALUATION.md](LONG_LIVING_EVALUATION.md)
- [LONG_LIVING_SERVICE_PLAN.md](LONG_LIVING_SERVICE_PLAN.md)
- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)

## Operations & Compliance Playbooks

- Canonical single-phase playbook (24/7): [LONG_LIVING_EVALUATION.md](LONG_LIVING_EVALUATION.md)
- Bash-first infra controls: `npm run ll:infra:autostart`, `npm run ll:infra:monitor`, `npm run ll:infra:stop`, `npm run ll:daily:feedback`
- Deprecated redirect (service plan): [LONG_LIVING_SERVICE_PLAN.md](LONG_LIVING_SERVICE_PLAN.md)
- Deprecated redirect (deployment guide): [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)

## Stage Cache

Legacy historical artifacts only (not active governance for long-living readiness):

- [Stage Cache Overview](stage-cache/PHASE_2_STATUS.md)
- [Phase 2 Validation Gate](stage-cache/PHASE_2_VALIDATION_GATE.md)
- [Implementation Roadmap](stage-cache/IMPLEMENTATION_ROADMAP.md)
- [Implementation Complete](stage-cache/IMPLEMENTATION_COMPLETE.md)
