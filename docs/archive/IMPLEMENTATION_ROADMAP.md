# Implementation Roadmap (Single Long-Living Phase)

**Last Updated**: 2026-03-06
**Status**: Active 24/7 long-living governance

## Canonical Gate

All readiness, runtime validation, and promotion decisions are governed by:

- [LONG_LIVING_EVALUATION.md](LONG_LIVING_EVALUATION.md)

## Model

The project operates under one continuous phase with micro stages:

1. Micro A — Fire readiness (required command sequence + hard gates)
2. Micro B — Runtime routing validation (TUI action + finalRoute + terminal collection)
3. Micro C — Stability and safety (fallback triggers, monitoring, alerts)
4. Micro D — CI/commit governance (CI graph interpretation + hot-commit exit criteria)

## Active Priorities

- Maintain deterministic no-data-loss evidence in `src/db/output/*`.
- Keep hard-gate verification green on CI and daily validation runs.
- Keep manual enrichment path unified (`manual-enrichment -> enhanced-tui`).
- Reduce operational risk with clear fallback and alert-resolution discipline.

## Definition of Progress

Progress is accepted only when runtime evidence and hard gates stay healthy over repeated cycles, not by phase label transitions.

## Archived Planning Note

Legacy phase planning artifacts (3A/3B/3C + draft eval) are retired from active governance.
