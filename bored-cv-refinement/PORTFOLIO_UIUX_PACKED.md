# Portfolio UI/UX Packed Handoff

## Scope

This document packs the completed work for the portfolio landing flow, data sync safety, and proof-mode readability.

## Completed

### 1) Layout + flow contract (enforced)

- Desktop-first composition with ratio-preserving paper scaling.
- Width modes: `auto`, `xs(600)`, `s(700)`, `m(800)`, `l(900)`.
- Vertical-scroll-first stage behavior.
- Fixed audience reading order: Recruiter -> HR -> Engineer.

### 2) 3:2:5 storytelling structure (enforced)

- Recruiter (3 parts): target role, verdict, key metrics.
- HR (2 parts): team fit, org fit.
- Engineer/CTO (5 parts): connector strip, proof rows, anomalies, architecture snapshot, next action.

### 3) Two display modes (de-load)

- Scan mode (default): lighter content for quick decision.
- Proof mode: full technical context.
- Heavy transparency content remains available but visually de-loaded in Proof mode with preview + expandable details.

### 4) Connector semantics + readability

- Metadata-driven node palette mapping in connector strip.
- Edge semantic styles in place (support/derived/risk, including dashed risk edges).
- In-component legend added for immediate meaning clarity.

### 5) Typography + visual consistency

- Serious dark GitHub + synthwave tone kept.
- Typography rhythm tightened and unified for readability in dense Proof content.
- Board-level typography vars applied from shell to keep consistency.

### 6) Transparency model centralized

- Shared transparency constants and formulas moved to one source:
  - model name/version
  - generated timestamp
  - formulas and thresholds

### 7) Sync safety (backward compatibility)

- `profile.prebuilt.json` remains source of truth.
- `sync-profile.ts` normalization hardened:
  - safe defaults
  - whitespace normalization
  - text compaction
  - array dedupe
  - bounded list lengths
  - unique evidence ID generation
- Marker-based generated region updates in `data.ts` to avoid brittle replacement.

## Data Pipeline (authoritative)

1. Edit `profile.prebuilt.json`.
2. Run sync script.
3. Regenerate only profile block in `portfolio/data.ts` between profile markers.
4. Landing page consumes stable `ProfileCore` shape.

## Safe Runbook

```bash
pnpm sync:profile
npm --prefix portfolio/landing-page run build
```

Watch mode:

```bash
pnpm sync:profile:watch
```

## Known remaining unrelated blocker

Current build still reports pre-existing TS6133 warnings in `portfolio/landing-page/src/components/MatrixGrid.vue` (unused symbols). This is outside the completed flow and sync hardening work.

## Next small step (optional)

- Add one command in root package scripts for: sync + build + quick check.
- Keep additive-only model changes for future compatibility.
