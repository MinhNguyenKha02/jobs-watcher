# Profile Service Specification

## 1. Architecture & Dependency Graph

```
[Source Data] (build-time)
  src/source/profile.source.ts       → ProfileSource
  src/source/relations.source.ts     → RelationsSource
  src/source/templates.source.ts     → Lexical templates
       │
       ▼
[Artifact Producers] (build-time, run once)
  AnchorProducer                     → anchors.json
  EvidenceProducer                   → evidences.json
  LexicalSurfaceProducer             → LexicalSurface[] (lang-split at write)
  AdjacencyProducer                  → adjacency.json
  AnchorEvidenceProducer             → anchor-to-evidence.json
       │
       ▼
[Artifact Builder + Writer] (build-time)
  artifact.builder.ts — serialises 7 files:
    anchors.json, evidences.json, surfaces.en.json, surfaces.vi.json,
    adjacency.json, anchor-to-evidence.json, metadata.json
       │
       ▼
[Artifact Loaders] (load-time, cached via ArtifactRegistry singleton)
  ArtifactLoader                     → reads 6 JSON files (excl. metadata)
  ArtifactHydrator                   → builds 2 AhoCorasick tries (en/vi) from surfaces
       │
       ▼
[HydratedArtifactBundle]  { anchors, evidences, enSurfaces, viSurfaces, adjacency, anchorToEvidence, aho: { en, vi } }
       │
       ▼
[ProfileInfoRetriever]  (facade, owns engine + resolver + artifacts)
       │
       ├──► [ProfileRetrievalEngine.retrieve(jobText)]
       │     1. NormalizationPipeline.prepare()        ← normalize THEN boundary-wrap
       │     2. detectLanguage(jobText)                  → 'en' | 'vi'
       │     3. aho[lang].traverse()                     → direct matches
       │     4. ExpansionResolver.expand()               → expanded matches
       │     5. EvidenceResolver.resolve()               → evidence scores
       │
       └──► [ResumeResolver.resolve()]
             1. RetrievalRanker.rank() per signal          → RankedSignal
             2. EvidenceAttachmentValidator.validate()     → ValidationResult
             3. RetrievalAcceptanceResolver.accept()       → RetrievalAcceptance
             4. Enumerate unmatched tech anchors           → synthetic RankedSignal[]
             5. AtsSkillGroupCompiler.compile()            → AtsSkillSection
             6. Filter/sort evidences → experiences/projects
             7. Build ResolveOutput { skills, experiences, projects, traces }
```

### Dependency Direction
```
Source files       →  Producers      →  JSON artifacts (7 files)
JSON artifacts     →  Loaders        →  HydratedArtifactBundle
Bundle             →  RetrievalEngine →  RetrievalOutput
RetrievalOutput    →  ResumeResolver  →  ResolveOutput
```

### Stateless vs Cached
| Component | State | Lifetime |
|---|---|---|
| ArtifactProducers | Stateless | Per-build |
| ArtifactLoader | Stateless | Per-load |
| ArtifactRegistry | Singleton, cached | Process lifetime |
| AhoCorasick tries (en/vi) | Immutable after build | Process lifetime |
| ProfileRetrievalEngine | Stateless (holds ref to bundle) | Per-request |
| ExpansionResolver | Stateless (creates builder per call) | Per-call |
| EvidenceResolver | Stateless | Per-call |
| RetrievalRanker | Stateless | Per-signal |
| ResumeResolver | Stateless (owns ranker/validator/compiler) | Per-request |
| RetrievalLogger | Singleton, mutable buffer | Process lifetime |
| ProfileInfoRetriever | Holds engine + resolver + artifacts | After init() |

---

## 2. Pipeline: Step-by-Step Orchestration

### ProfileRetrievalEngine.retrieve(jobText: string): RetrievalOutput

| Step | Component | Class.Method | Input | Output | Side Effects |
|---|---|---|---|---|---|
| 1 | NormalizationPipeline | `prepare(text)` | raw jobText string | normalized + boundary-wrapped string | None |
| 2 | ProfileRetrievalEngine | `detectLanguage(text)` | raw jobText string | `'en'` or `'vi'` | None |
| 3 | AhoCorasick (per lang) | `traverse(text)` | prepared string | `Map<AnchorId, MatchSignal>` (direct) | None |
| 4 | ExpansionResolver | `expand(matches, adjacency)` | direct + AdjacencyMap | `Map<AnchorId, MatchSignal>` (expanded) | Inflates source signal score via `appendPropagation` with raw edge weight; adds propagated score to target |
| 5 | EvidenceResolver | `resolve(expanded)` | expanded + evidences + anchorToEvidence | `RetrievalEvidenceScore[]` sorted desc | Sets `signal.evidenceIds` on each signal |

### ResumeResolver.resolve(retrieval: RetrievalOutput, artifacts: HydratedArtifactBundle, jobId?: string)

| Step | Component | Class.Method | Input | Output | Side Effects |
|---|---|---|---|---|---|
| 1 | RetrievalRanker | `rank(signal, direct, expanded, evidences)` | signal + maps | `RankedSignal { finalScore, resolutionStrength }` | None |
| 2 | EvidenceAttachmentValidator | `validate(signal, artifacts, jobId)` | signal + bundle + jobId | `ValidationResult` | Logs via RetrievalLogger on failure |
| 3 | RetrievalAcceptanceResolver | `accept(signal, scoreToUse?)` | signal + optional score | `RetrievalAcceptance` | None |
| 4 | ResumeResolver | enumerate unmatched tech anchors | artifact anchors | synthetic `RankedSignal[]` | Builds signals for tech-kind anchors not in expanded, with evidence |
| 5 | AtsSkillGroupCompiler | `compile(matched, unmatched, anchorMap)` | ranked + unmatched + anchor map | `AtsSkillSection` | None |
| 6 | ResumeResolver | filter/sort evidences | evidence scores | filtered + sorted + capped lists | None |
| 7 | ResumeResolver | build traces | ranked signals | Trace[] with resolutionStrength | None |

---

## 3. Full Type Definitions

### From `types/retrieval.types.ts`

```typescript
type AnchorKind = 'cap' | 'comp' | 'beh' | 'tech'
type ResolutionStrength = 'strong' | 'partial' | 'weak' | 'missing'
type AnchorId = `cap.${string}` | `comp.${string}` | `beh.${string}` | `tech.${string}`
type EvidenceId = `ev.${string}`
type MatchSource = 'canonical' | 'adjacent' | 'vendor' | 'template'
type RetrievalStage = 'lexical' | 'propagation'
type AdjacencyMap = Map<AnchorId, AdjacencyEdge[]>
type AnchorToEvidenceMap = Map<AnchorId, Set<EvidenceId>>
type Evidence = EvidenceNode  // backward-compatible alias

interface AnchorNode {
  id: AnchorId
  kind: AnchorKind
  category: string
  key: string
}

interface EvidenceNode {
  id: EvidenceId
  anchorIds: AnchorId[]
  type: 'project' | 'experience'
  title?: string
  position: string
  company?: string
  startDate: string
  endDate: string
  summary?: string
  bullets: EvidenceBullet[]
  links?: Record<string, string[]>
}

interface EvidenceBullet {
  text: string
  kind: 'responsibility' | 'outcome'
  weight?: number
}

interface LexicalSurface {
  pattern: string
  anchorId: AnchorId
  language: 'en' | 'vi'
  source: MatchSource
  weight: number
}

interface AdjacencyEdge {
  from: AnchorId
  to: AnchorId
  weight: number
}

interface MatchOccurrence {
  pattern: string
  source: MatchSource
  weight: number
  start: number
  end: number
}

interface MatchTrace {
  type: 'lexical-hit' | 'propagation' | 'resolver-accepted' | 'resolver-rejected'
  from?: AnchorId
  to?: AnchorId
  scoreDelta: number
  reason: string
  resolutionStrength?: ResolutionStrength
}

interface MatchSignal {
  anchorId: AnchorId
  score: number
  confidence: number
  occurrences: number
  stages: Set<RetrievalStage>
  evidenceIds: Set<EvidenceId>
  matchedPatterns: string[]
  occurrencesDetail: MatchOccurrence[]
  sources: Set<MatchSource>
  trace: MatchTrace[]
}

interface RetrievalAcceptance {
  accepted: boolean
  reason: string
  score: number
}

interface RetrievalArtifacts {
  anchors: Map<AnchorId, AnchorNode>
  evidences: Map<EvidenceId, EvidenceNode>
  surfaces: LexicalSurface[]
  adjacency: AdjacencyMap
  anchorToEvidence: AnchorToEvidenceMap
}
```

### From `artifacts/types/artifact.types.ts`

```typescript
interface ArtifactBundle {
  anchors: Map<AnchorId, AnchorNode>
  evidences: Map<EvidenceId, EvidenceNode>
  enSurfaces: LexicalSurface[]
  viSurfaces: LexicalSurface[]
  adjacency: AdjacencyMap
  anchorToEvidence: AnchorToEvidenceMap
}

interface HydratedArtifactBundle extends ArtifactBundle {
  aho: { en: AhoCorasick; vi: AhoCorasick }
}

interface RetrievalEvidenceScore {
  score: number
  evidence?: EvidenceNode
}

interface RetrievalResult {
  direct: Map<AnchorId, MatchSignal>
  expanded: Map<AnchorId, MatchSignal>
  evidences: RetrievalEvidenceScore[]
}

interface ArtifactMetadata {
  generatedAt: string
  version: number
}
```

### From `contracts/retrieval.types.ts`

```typescript
interface RetrievalOutput {
  direct: Map<AnchorId, MatchSignal>
  expanded: Map<AnchorId, MatchSignal>
  evidences: RetrievalEvidenceScore[]
}
```

### From `types/resolve.types.ts`

```typescript
type ResolveOutput = {
  skills: AtsSkillSection
  experiences: RetrievalEvidenceScore[]
  projects: RetrievalEvidenceScore[]
  traces: Trace[]
}
```

### From `source/source.types.ts`

```typescript
type RecruiterSurfaces = {
  en: string[]
  vi: string[]
}

interface RelationNode {
  adjacent: string[]
  recruiter_surfaces: RecruiterSurfaces
  retrieval_associations: string[]
}
type RelationCategory = Record<string, RelationNode>
type RelationsSource = Partial<Record<AnchorKind, Record<string, RelationCategory>>>

interface ProjectSource {
  name: string
  position: string
  startDate: string
  endDate?: string
  type: string
  anchors: { cap?, comp?, beh?, tech? }
  summary?: string
  key_contributions: string[]
  outcomes: string[]
  status?: string
  evidences?: Record<string, string[]>
}

interface ExperienceSource {
  company: string
  position: string
  location?: string
  startDate: string
  endDate?: string
  anchors: { cap?, comp?, beh?, tech? }
  responsibilities: string[]
  outcomes: string[]
}

interface ProfileSource {
  name: string
  email: string
  phone?: string
  location?: string
  title?: string
  cap?: ProfileAnchorSection
  comp?: ProfileAnchorSection
  beh?: ProfileAnchorSection
  tech?: ProfileAnchorSection
  projects?: ProjectSource[]
  experiences?: ExperienceSource[]
  education?: EducationSource[]
  links?: Record<string, string>
}

type ProfileAnchorSection = { [category: string]: string[] }
```

### From `ranking/ranking-features.ts` and `ranking/retrieval-ranker.ts`

```typescript
interface RankingFeatures {
  lexicalScore: number
  propagationScore: number
  evidenceScore: number
  sourceDiversity: number
  occurrenceScore: number
  adjacencyConfidence: number   // currently always 0 (not implemented)
  atsVisibilityWeight: number   // currently always 0 (not implemented)
}

interface RankedSignal {
  signal: MatchSignal
  finalScore: number
  resolutionStrength: ResolutionStrength
}
```

### From `retrieval/retrieval-logger.ts`

```typescript
interface RetrievalLogEntry {
  timestamp: string
  jobId: string
  type: 'lexical-hit' | 'propagation' | 'acceptance' | 'ats-exposure'
       | 'evidence-attachment-missing' | 'resolution-classified' | 'evidence-ranked'
  data: Record<string, any>
}
```

### From `resume/compiler/ats-skill-group.compiler.ts`

```typescript
interface AtsSkillGroup {
  label: string
  skills: string[]
}

interface AtsSkillSection {
  primary: AtsSkillGroup[]
  secondary?: AtsSkillGroup[]
}
```

### From `retrieval/retrieval-debugger.ts`

```typescript
interface DebugTraceEntry {
  type: string
  scoreDelta: number
  reason: string
  from?: string
  to?: string
  resolutionStrength?: ResolutionStrength
}

interface Trace {
  anchorId: AnchorId
  score: number
  trace: {
    resolutionStrength: ResolutionStrength
    type: 'lexical-hit' | 'propagation' | 'resolver-accepted' | 'resolver-rejected'
    from?: AnchorId
    to?: AnchorId
    scoreDelta: number
    reason: string
  }[]
}

interface DebugSnapshot {
  matchedAnchors: { anchorId, matchedPatterns, score, confidence, occurrences, sources, trace }[]
  propagatedAnchors: { anchorId, score, confidence, sources, trace }[]
  evidenceScores: { score, evidence: { type, title, company?, summary? } | null }[]
  resolvedTraces: { anchorId, score, resolutionStrength, trace }[]
}
```

---

## 4. I/O Contracts (per exported component)

### ProfileInfoRetriever
- **File:** `index.ts`
- **Constructor:** `()`
- **Methods:**
  - `init(): Promise<void>` — checks if `ARTIFACT_OUTPUT_DIR` exists; if not, runs `buildArtifacts()`; clears cache; boots engine + loads artifacts + creates resolver
  - `ensureInitialized(): void` — throws if engine/resolver/artifacts not set
  - `retrieve(jobText: string): RetrievalOutput` — delegates to engine
  - `resolve(retrieval: RetrievalOutput): ResolveOutput` — delegates to resolver
  - Never throws from retrieve/resolve if initialized

### ProfileRetrievalEngine
- **File:** `retrieval/profile-retrieval-engine.ts`
- **Constructor:** `(artifacts: HydratedArtifactBundle)`
- **Methods:**
  - `detectLanguage(text: string): 'en' | 'vi'` — scans for Vietnamese Unicode range `[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]`; returns `'vi'` on match, `'en'` otherwise
  - `retrieve(jobText: string): RetrievalOutput` — runs prepare → detectLanguage → `aho[lang].traverse()` → expand → resolve
  - Never throws (empty maps on no match)

### NormalizationPipeline
- **File:** `retrieval/normalization.pipeline.ts`
- **Methods:**
  - `normalize(text: string): string` — lowercase → NFKC → strip non-`[a-z0-9+#.\-/\s]` → collapse whitespace → trim
  - `tokenize(text: string): string[]` — normalize + split on space
  - `boundaryWrap(text: string): string` — `" " + normalize(text) + " "`
  - `prepare(text: string): string` — `boundaryWrap(normalize(text))` (note: text normalized twice — once in prepare, once inside boundaryWrap)

### AhoCorasick
- **File:** `retrieval/aho-corasick.ts`
- **Methods:**
  - `insert(output: { anchorId, pattern, weight, source }): void`
  - `buildFallbackLinks(): void` — BFS from root
  - `traverse(text: string): Map<AnchorId, MatchSignal>` — scans char-by-char, builds signals via MatchSignalBuilder
  - Emits start=0, end=0 for all occurrences (position tracking not implemented)

### ExpansionResolver
- **File:** `retrieval/expansion-resolver.ts`
- **Method:**
  - `expand(matches: Map<AnchorId, MatchSignal>, adjacency: AdjacencyMap): Map<AnchorId, MatchSignal>`
  - Iterates direct matches; for each adjacent edge:
    1. Calls `appendPropagation({ signal: source, from: anchorId, weight: edge.weight })` — inflates **source** signal score by raw `edge.weight`
    2. Adds `sourceSignal.score * edge.weight` to **target** signal score
  - Only propagates to anchors already in `matches` (skips un-matched)
  - Increments target `occurrences` by 1, adds `'adjacent'` to target `sources`

### EvidenceResolver
- **File:** `retrieval/evidence-resolver.ts`
- **Constructor:** `(evidences, anchorToEvidence)`
- **Method:**
  - `resolve(signals: Map<AnchorId, MatchSignal>): RetrievalEvidenceScore[]`
  - Sums `signal.score` per evidenceId across all matched anchors
  - **Side effect:** sets `signal.evidenceIds = evidenceIds` on each signal
  - Returns sorted descending by score

### EvidenceAttachmentValidator
- **File:** `retrieval/validation/evidence-attachment.validator.ts`
- **Method:**
  - `validate(signal, artifacts, jobId): ValidationResult`
  - Checks: (1) anchor exists, (2) anchor has evidence mappings, (3) at least one evidenceId exists in map
  - Logs `evidence-attachment-missing` on any failure

### RetrievalAcceptanceResolver
- **File:** `retrieval/resolver/retrieval-acceptance.resolver.ts`
- **Constructor:** `(policy: RetrievalPolicy)`
- **Methods:**
  - `accept(signal, scoreToUse?): RetrievalAcceptance`
  - `sort(signals): MatchSignal[]` — by score desc

### RetrievalRanker
- **File:** `retrieval/ranking/retrieval-ranker.ts`
- **Method:**
  - `rank(signal, directSignals, expandedSignals, evidences): RankedSignal`
  - Computes weighted sum of 7 features, clamps to >=0, classifies resolution strength

### RankingFeaturesExtractor
- **File:** `retrieval/ranking/ranking-features.ts`
- **Static method:**
  - `extract(signal, directSignals, expandedSignals, evidences): RankingFeatures`
  - `adjacencyConfidence` and `atsVisibilityWeight` are **always 0** (not yet implemented)

### MatchSignalBuilder
- **File:** `retrieval/scoring/match-signal.builder.ts`
- **Constructor:** `(policy: RetrievalPolicy)`
- **Methods:**
  - `create(anchorId): MatchSignal` — initializes empty signal with score=0, confidence=0, occurrences=0
  - `finalize(signal): void` — computes `confidence = min(1, (score*0.6 + occurrences*0.15 + sources.size*0.25) / 5)`
  - `appendLexicalHit({ signal, pattern, source, weight, start, end }): void` — increments score with saturation
  - `appendPropagation({ signal, from, weight }): void` — adds weight directly to score, adds trace

### PropagationEngine
- **File:** `retrieval/propagation/propagation-engine.ts`
- **Constructor:** `(policy, adjacency, builder?)`
- **Method:**
  - `propagate(direct): Map<AnchorId, MatchSignal>` — recursive graph walk, respects maxDepth/blockedKinds/minEdgeWeight/maxExpandedAnchors
  - **Compounding:** Each hop uses the `propagated` value from previous edge as `score` for the next: `propagated = incomingScore * edgeWeight * decayFactor`

### EvidenceRanker
- **File:** `retrieval/evidence/evidence-ranker.ts`
- **Static method:**
  - `scoreEvidence(evidence): number` — weighted sum of 4 feature scores

### EvidenceFeaturesExtractor
- **File:** `retrieval/evidence/evidence-feature-extractor.ts`
- **Static method:**
  - `extract(evidence): EvidenceFeatures` — keyword-based scoring per feature

### RetrievalRanking (utility)
- **File:** `retrieval/retrieval-ranking.ts`
- **Static methods:**
  - `dampen(score): number` — `log1p(max(score, 0))`
  - `normalize(score): number` — `min(1, log1p(max(score, 0)))`
  - `boostExact(score, exactMatches): number` — `score + exactMatches * 0.15`
  - `penalizeDuplicate(score, duplicateCount): number` — `score / (1 + duplicateCount * 0.2)`

### ResumeResolver
- **File:** `resume/resolve/resume-resolver.ts`
- **Method:**
  - `resolve(retrieval, artifacts, jobId?)` — ranks → validates → accepts → enumerates unmatched tech anchors → compiles skills → filters experience/projects → builds traces
  - **Unmatched tech anchor logic:** Iterates all artifact anchors; for tech-kind anchors NOT in expanded map that have evidence: computes `finalScore = min(evidenceCount/2, 1) * 0.6 + maxEvidenceBaseScore * 0.4`, creates synthetic MatchSignal, checks tiered acceptance (`matched 0.55 / unmatched 0.35`); appends to compiler input
  - Returns `ResolveOutput`

### BulletSelector
- **File:** `resume/resolve/bullet-selector.ts`
- **Method:**
  - `topK(bullets: string[], limit = 4): string[]` — sort by length desc, take top K

### SkillKeyNormalizer
- **File:** `resume/normalization/skill-key-normalizer.ts`
- **Static methods:**
  - `normalizeSkillName(key): string` — split on `[-_]`, capitalize first letter of each part, join with space
  - `mapCategoryToLabel(category): string` — maps category key to label (used by `getCategoryOrder`); falls through to `normalizeSkillName` on unknown
  - `getCategoryOrder(): string[]` — returns ordered category labels (not used by AtsSkillGroupCompiler)

### SkillClusterResolver
- **File:** `resume/normalization/skill-cluster-resolver.ts`
- **Method:**
  - `resolve(anchorNode): string` — normalizes anchor key, looks up in canonicalSkillMap, returns canonical or normalized

### AtsSkillGroupCompiler
- **File:** `resume/compiler/ats-skill-group.compiler.ts`
- **Method:**
  - `compile(matchedSignals: MatchSignal[], unmatchedSignals: MatchSignal[], anchorMap: Map<string, AnchorNode>): AtsSkillSection`
  - Groups by category via `AtsSkillGroupMapper.mapCategoryToGroupLabel()`
  - Only `'tech'` anchors → `'primary'` section; `'cap'`/`'comp'` → `'secondary'` → skipped; `'beh'` → explicitly excluded
  - Matched signals appear before unmatched within each group; groups sorted alphabetically by label
  - Canonicalizes names via `SkillClusterResolver`

### AtsSkillGroupMapper
- **File:** `resume/compiler/ats-skill-group.mapper.ts`
- **Static methods:**
  - `mapCategoryToGroupLabel(category): string` — maps e.g., `'backend'` → `'Backend'`, `'language'` → `'Languages'`, `'backend_framework'` → `'Frameworks'`
  - `getSectionKind(kind): 'primary' | 'secondary'` — `'tech'` → `'primary'`, all others → `'secondary'`

### bootstrapRetrieval
- **File:** `retrieval/retrieval-engine.ts`
- **Async function:** `bootstrapRetrieval(): Promise<ProfileRetrievalEngine>` — loads + caches artifacts, creates engine

### ArtifactRegistry
- **File:** `artifacts/loaders/artifact-cache.ts`
- **Singleton methods:**
  - `getInstance(): ArtifactRegistry`
  - `getArtifacts(): Promise<HydratedArtifactBundle>` — returns cached or loads + hydrates
  - `static clearCache(): void`
  - `static hasCachedArtifacts(): boolean`
  - Double-checked locking pattern for thread safety

### ArtifactLoader
- **File:** `artifacts/loaders/artifact.loader.ts`
- **Method:**
  - `load(): Promise<ArtifactBundle>` — reads 6 JSON files in parallel (anchors, evidences, enSurfaces, viSurfaces, adjacency, anchorToEvidence), deserialises Map/Set structures

### ArtifactHydrator
- **File:** `artifacts/loaders/artifact-hydrator.ts`
- **Method:**
  - `hydrate(artifacts: ArtifactBundle): HydratedArtifactBundle` — builds 2 AhoCorasick tries from `enSurfaces` (→ `aho.en`) and `viSurfaces` (→ `aho.vi`) via AhoProducer

### buildArtifacts (build entrypoint)
- **File:** `artifacts/builders/artifact.builder.ts`
- **Async function:**
  - `buildArtifacts(): Promise<void>` — runs all 5 producers, splits surfaces by language, writes 7 JSON files (6 artifacts + metadata.json)

### AnchorProducer
- **File:** `artifacts/producers/anchor.producer.ts`
- **Method:**
  - `produce(profile: ProfileSource): Map<AnchorId, AnchorNode>` — iterates `cap/comp/beh/tech` sections, creates `section.category.value` → `{ id, kind, category, key }`

### EvidenceProducer
- **File:** `artifacts/producers/evidence.producer.ts`
- **Method:**
  - `produce(profile: ProfileSource): Map<EvidenceId, EvidenceNode>` — iterates projects + experiences, maps `project.key_contributions` → bullets (weight=0.8), `outcomes` → bullets (weight=1.0); maps `evidences` → `links`

### LexicalSurfaceProducer
- **File:** `artifacts/producers/lexical-surface.producer.ts`
- **Method:**
  - `produce(relations: RelationsSource): LexicalSurface[]` — generates all surfaces (canonical, template, vendor) for both languages as a flat array; deduplicates by `{ anchorId, pattern, language, source }`
  - Canonical surfaces: weight=1.0, from `recruiter_surfaces.en/vi`
  - Template surfaces: weight=0.8, combinatorial (each surface x each template for each of 3 TemplateKinds)
  - Vendor surfaces: weight=0.35, raw vendor names (both languages) + vendor template patterns for all 3 kinds, both languages

### AdjacencyProducer
- **File:** `artifacts/producers/adjacency.producer.ts`
- **Constructor:** `(validAnchors: Set<AnchorId>)`
- **Method:**
  - `produce(relations: RelationsSource): AdjacencyMap` — creates edges with weight 0.35
  - Target resolution: same-category → same-kind (all categories) → all kinds (fallback)
  - Missing targets silently skipped

### AnchorEvidenceProducer
- **File:** `artifacts/producers/anchor-evidence.producer.ts`
- **Method:**
  - `produce({ evidences }): AnchorToEvidenceMap` — iterates all evidence nodes, maps their anchorIds to evidence IDs

### AhoProducer
- **File:** `artifacts/producers/aho.producer.ts`
- **Method:**
  - `produce(surfaces: LexicalSurface[]): AhoCorasick` — inserts each surface (lowercased, boundary-wrapped), builds fallback links
  - Called twice at hydration: once for `enSurfaces` → `aho.en`, once for `viSurfaces` → `aho.vi`

### RetrievalLogger
- **File:** `retrieval/logging/retrieval-logger.ts`
- **Singleton methods:**
  - `getInstance(): RetrievalLogger`
  - `logLexicalHit(jobId, anchorId, pattern, source, weight, score)`
  - `logPropagation(jobId, fromAnchorId, toAnchorId, edgeWeight, decayFactor, propagatedScore)`
  - `logAcceptance(jobId, anchorId, accepted, reason, score, confidence)`
  - `logAtsExposure(jobId, anchorId, anchorKind, skillName, visibility, shown)`
  - `logEvidenceAttachmentMissing(jobId, anchorId)`
  - `logResolutionClassified(jobId, anchorId, finalScore, strength)`
  - `logEvidenceRanked(jobId, evidenceId, score)`
  - `getRecentLogs(count?)` / `getLogsByType(type)` / `getLogsByJobId(jobId)` / `clearLogs()`
  - Internal buffer max: 1000 entries

### RetrievalDebugger
- **File:** `retrieval/retrieval-debugger.ts`
- **Exported function:**
  - `captureDebug(retrieval: RetrievalOutput, result?): DebugSnapshot` — converts retrieval pipeline output + resolved traces to human-readable debug snapshot
- **Used by:** regression test pipeline

---

## 5. Policy Constraints (exhaustive)

### RetrievalPolicy (`retrieval/policies/retrieval.policy.ts`)

| Path | Key | Value | Description |
|---|---|---|---|
| `direct` | `minScore` | `0.2` | Minimum score for a direct match before it can participate in propagation |
| `direct` | `occurrenceSaturation` | `4` | After N same-pattern occurrences, diminishing returns max |
| `direct.sourceWeights` | `canonical` | `1` | Weight multiplier for canonical source matches |
| `direct.sourceWeights` | `adjacent` | `0.55` | Weight multiplier for adjacent source matches |
| `direct.sourceWeights` | `vendor` | `0.35` | Weight multiplier for vendor source matches |
| `direct.sourceWeights` | `template` | `0.8` | Weight multiplier for template source matches |
| `direct.stageWeights` | `lexical` | `1` | Weight multiplier for lexical stage |
| `direct.stageWeights` | `propagation` | `0.65` | Weight multiplier for propagation stage |
| `propagation` | `enabled` | `true` | Whether propagation is active |
| `propagation` | `maxDepth` | `2` | Max graph walk depth from direct match |
| `propagation` | `minEdgeWeight` | `0.2` | Edges below this weight are ignored |
| `propagation` | `decayFactor` | `0.72` | Score multiplier applied per hop (compounds) |
| `propagation` | `maxExpandedAnchors` | `32` | Cap on unique anchor entries in expanded map |
| `propagation.blockedKinds` | — | `['beh']` | Anchor kinds that never propagate |
| `resolver` | `minAcceptedScore` | `0.55` | Minimum `finalScore` to accept a matched signal (tiered: matched `0.55`) |
| `resolver` | `minUnmatchedAcceptedScore` | `0.35` | Minimum `finalScore` to accept an unmatched tech fallback signal (tiered: unmatched `0.35`, `≥partial` `0.4` threshold aligned) |
| `resolver` | `maxSkills` | `18` | Maximum skills in output (not implemented in compiler) |
| `resolver` | `maxProjects` | `2` | Maximum project evidence entries |
| `resolver` | `maxExperience` | `2` | Maximum experience evidence entries |
| `resolver` | `requireEvidenceForSkills` | `true` | Reject lexical-only signals without evidence IDs |
| `visibility` | `cap` | `'hidden'` | Capability anchors excluded from ATS output |
| `visibility` | `tech` | `'primary'` | Technology anchors primary ATS section |
| `visibility` | `comp` | `'hidden'` | Competency anchors excluded from ATS output |
| `visibility` | `beh` | `'hidden'` | Behavioral anchors excluded from ATS output |
| `resolution` | `strongThreshold` | `0.7` | Score >= this + direct evidence strong |
| `resolution` | `partialThreshold` | `0.4` | Score >= this partial |
| `resolution` | `weakThreshold` | `0.2` | Score >= this weak |
| `resolution` | `missingThreshold` | `0.0` | Below this missing |

**Note:** The AtsSkillGroupCompiler does NOT directly consult the visibility policy. It uses `AtsSkillGroupMapper.getSectionKind()` which returns `'primary'` only for `tech` anchors. Since the compiler only collects `'primary'` signals into its group map, only `tech` anchors appear in ATS output. The visibility policy is used by `ResumeResolver.resolve()` for logging ATS exposure decisions.

### RankingPolicy (`retrieval/ranking/ranking-policy.ts`) — sum = 1.00

| Key | Value | Description |
|---|---|---|
| `lexicalWeight` | `0.35` | Contribution of lexical match score |
| `propagationWeight` | `0.25` | Contribution of propagation-derived score |
| `evidenceWeight` | `0.20` | Contribution of evidence feature score |
| `sourceDiversityWeight` | `0.10` | Contribution of unique source count |
| `occurrenceWeight` | `0.05` | Contribution of occurrence count |
| `adjacencyConfidenceWeight` | `0.03` | Contribution of adjacency confidence (currently 0 in extractor) |
| `atsVisibilityWeight` | `0.02` | Contribution of ATS visibility weight (currently 0 in extractor) |

### EvidenceRankingPolicy (`retrieval/evidence/evidence-ranking-policy.ts`) — sum = 1.00

| Key | Value | Description |
|---|---|---|
| `operationalWeight` | `0.30` | Weight for operational keywords |
| `architectureWeight` | `0.30` | Weight for architecture keywords |
| `ownershipWeight` | `0.20` | Weight for ownership keywords |
| `quantifiedWeight` | `0.20` | Weight for quantified metric matches |

---

## 6. Score Calculation Formulas

### MatchSignalBuilder.appendLexicalHit
```
weighted = rawWeight * sourceWeight[source] * stageWeights.lexical
saturation = min(1, occurrences / occurrenceSaturation)
effective = weighted * (1 - saturation * 0.45)
signal.score += effective
```

**Example:** canonical hit, rawWeight=2.0, occurrenceSaturation=4, 1st occurrence:
```
weighted    = 2.0 * 1.0 (canonical) * 1.0 (lexical) = 2.0
saturation  = min(1, 1/4) = 0.25
effective   = 2.0 * (1 - 0.25 * 0.45) = 2.0 * 0.8875 = 1.775
```

**Diminishing returns example:** same pattern, 4th occurrence:
```
saturation = min(1, 4/4) = 1.0
effective  = 2.0 * (1 - 1.0 * 0.45) = 2.0 * 0.55 = 1.1
```

### MatchSignalBuilder.appendPropagation
```
signal.score += weight      // weight added directly
signal.stages.add('propagation')
```

### MatchSignalBuilder.finalize
```
confidence = min(1, (score * 0.6 + occurrences * 0.15 + sources.size * 0.25) / 5)
```

### ExpansionResolver.expand (per edge)
```
sourceSignal: appendPropagation({ signal: sourceSignal, weight: edge.weight })
  -> sourceSignal.score += edge.weight

target: existing.score += sourceSignal.score * edge.weight
target.occurrences += 1
target.sources.add('adjacent')
```

### PropagationEngine.propagate (per edge, at depth d)
```
propagated = score * edgeWeight * decayFactor
// decayFactor = 0.72, applied each hop
// score = incoming value (original direct score at depth 0,
//         or propagated value from parent at depth > 0)
// Therefore: hop1 = directScore * w1 * 0.72
//            hop2 = (directScore * w1 * 0.72) * w2 * 0.72  (compounds)
```

**Example:** directScore=1.0, edgeWeight=0.5, depth=1:
```
propagated = 1.0 * 0.5 * 0.72 = 0.36
```

**Additional guards in walk():**
- Skip if `depth >= maxDepth` (2)
- Skip if `edgeWeight < minEdgeWeight` (0.2)
- Skip if `propagated < minScore` (0.2)
- Skip if `expanded.size >= maxExpandedAnchors` (32)
- Skip if `kind` is in `blockedKinds` (`['beh']`)
- Skip if `origin:target:depth` already visited (per-path visited set)

### RetrievalRanker.rank
```
rawScore =
  lexicalScore * 0.35 +
  propagationScore * 0.25 +
  evidenceScore * 0.20 +
  sourceDiversity * 0.10 +
  occurrenceScore * 0.05 +
  adjacencyConfidence * 0.03 +
  atsVisibilityWeight * 0.02

finalScore = max(0, rawScore)
```

### EvidenceRanker.scoreEvidence
```
score = max(0,
  operational * 0.30 +
  architecture * 0.30 +
  ownership * 0.20 +
  quantified * 0.20)
```

### EvidenceFeaturesExtractor.calculateKeywordScore
```
score = matchedKeywords / totalKeywords
// Simple fraction, 0 if no keywords
```

### EvidenceFeaturesExtractor.calculateQuantifiedScore
```
patterns = [/\d+%/g, /\d+ms/g, /\d+x/g, /\d+k/g, /\d+m/g, /\d+/g]
totalMatches = sum of all pattern matches across all text
score = min(totalMatches / 5, 1)
```

### RetrievalRanking utility functions
```
dampen(score)     = log1p(max(score, 0))
normalize(score)  = min(1, log1p(max(score, 0)))
boostExact(s, n)  = s + n * 0.15
penalizeDup(s, n) = s / (1 + n * 0.2)
```

### EvidenceResolver.resolve
```
For each signal:
  for each evidenceId in anchorToEvidence[signal.anchorId]:
    evidenceScore[evidenceId] += signal.score
  signal.evidenceIds = evidenceIds  (side effect)
Return sorted by score descending
```

### ResumeResolver — Unmatched Tech Anchor Score (tiered `0.35`)
```
normalizedCount = min(evidenceCount / 2, 1)
finalScore = normalizedCount * 0.6 + maxEvidenceBaseScore * 0.4
// maxEvidenceBaseScore is max of EvidenceRanker.scoreEvidence across linked evidence
// Tiered acceptance: matched signals require finalScore ≥ 0.55, unmatched synth require ≥ 0.35 (cnt1 0.40 passes, cnt≥2 0.64 passes)
```

---

## 7. Resolution Classification Rules

### classifyResolutionStrength(finalScore, signal, policy)

```
hasDirectEvidence = signal.stages.has('lexical')
                    AND (!signal.stages.has('propagation') OR signal.stages.size > 1)

if finalScore >= 0.7 AND hasDirectEvidence           -> 'strong'
else if finalScore >= 0.4                             -> 'partial'
else if finalScore >= 0.2                             -> 'weak'
else                                                  -> 'missing'
```

| Condition | Resolution | Description |
|---|---|---|
| finalScore >= 0.7 AND has lexical evidence (not propagation-only) | strong | Direct evidence with high confidence score |
| finalScore >= 0.4 | partial | Good lexical match with limited direct evidence |
| finalScore >= 0.2 | weak | Propagation-derived or vendor-only match |
| finalScore < 0.2 | missing | Required signal not found in retrieval |
| finalScore >= 0.7 BUT propagation-only | NOT strong (falls to partial or below) | Cannot be strong without direct evidence |

Note: `hasDirectEvidence` means the signal has a `lexical` stage AND is not exclusively `propagation`.

### isSignalViable(signal, policy)
```
return signal.score >= policy.resolution.weakThreshold  // score >= 0.2
```

### getResolutionStrengthDescription
```
strong  -> 'Direct evidence with high confidence score'
partial -> 'Good lexical match with limited direct evidence'
weak    -> 'Propagation-derived or vendor-only match'
missing -> 'Required signal not found in retrieval'
```

---

## 8. Acceptance Rules

### RetrievalAcceptanceResolver.accept(signal, scoreToUse?, threshold?)

```
score = scoreToUse ?? signal.score
threshold = threshold ?? policy.resolver.minAcceptedScore // tiered: matched 0.55, unmatched 0.35 (SPEC 0.35 aligned)
if score < threshold:
    -> { accepted: false, reason: 'below-min-score', score }

if policy.resolver.requireEvidenceForSkills (true)
   AND signal.evidenceIds.size === 0
   AND NOT signal.stages.has('propagation'):
    -> { accepted: false, reason: 'missing-evidence', score }

-> { accepted: true, reason: 'accepted', score }
```

Decision table (matched threshold `0.55`, unmatched `0.35`; table shows unmatched tier):

| Score >= 0.35? | Has evidenceIds? | Propagation-only? | Result |
|---|---|---|---|
| No | — | — | rejected: below-min-score |
| Yes | Yes | — | accepted |
| Yes | No | No (lexical-only) | rejected: missing-evidence |
| Yes | No | Yes | accepted |
| Yes | No | Both lexical + propagation | accepted (has lexical stage) |

---

## 9. Evidence Feature Scoring — Keyword Dictionaries

### Operational keywords (`evidence-feature-extractor.ts:35-44`)
```
production, runtime, deployment, monitoring, observability,
alerting, workflow, systemd, daemon
```
Count: 9 keywords. Score = `matchedCount / 9`.

### Architecture keywords (`evidence-feature-extractor.ts:49-55`)
```
event-driven, orchestration, distributed, hexagonal, clean architecture, saga
```
Count: 6 keywords. Score = `matchedCount / 6`.

### Ownership keywords (`evidence-feature-extractor.ts:60-66`)
```
built, implemented, designed, developed, architected, led
```
Count: 6 keywords. Score = `matchedCount / 6`.

### Quantified patterns (`evidence-feature-extractor.ts:107-113`)
```
/\d+%/g    — percentages  (e.g., "40%")
/\d+ms/g   — milliseconds (e.g., "200ms")
/\d+x/g    — times        (e.g., "2x")
/\d+k/g    — thousands    (e.g., "10k")
/\d+m/g    — millions     (e.g., "5m")
/\d+/g     — plain numbers(e.g., "100")
```
Total matches summed across all patterns. Score = `min(totalMatches / 5, 1)`.

**Example:** "Improved performance by 40% and reduced latency by 200ms. Handled 10k requests/s."
- `40%` -> 1 match (percentage)
- `200ms` -> 1 match (milliseconds)
- `10k` -> 1 match (thousands)
- `200`, `40`, `10` -> 3 matches (numbers)
- Total = 6, score = min(6/5, 1) = 1.0

---

## 10. Error & Edge Case Propagation

| Scenario | Component | Behavior |
|---|---|---|
| Empty job text | NormalizationPipeline | Returns `""` (normalize trims to empty, boundaryWrap gives `"  "`) |
| Null/undefined job text | NormalizationPipeline | Throws `TypeError` (calls `.toLowerCase()` on undefined) |
| No surfaces in trie | AhoCorasick | `traverse()` returns empty `Map` |
| No matches in job text | AhoCorasick | Returns empty `Map` |
| Adjacency target not in matches | ExpansionResolver | Entry silently skipped (propagation only to existing) |
| Adjacency edge weight < minEdgeWeight | PropagationEngine | Edge ignored, continues to next |
| Blocked kind encountered | PropagationEngine | Edge skipped, continues through non-blocked edges |
| Propagation depth >= maxDepth | PropagationEngine | Returns, no further edge processing |
| Duplicate same-pattern hit | MatchSignalBuilder | Diminishing returns via saturation formula |
| Negative feature values | RetrievalRanker | Clamped to 0 via `max(0, rawScore)` |
| Signal score < minAcceptedScore | RetrievalAcceptanceResolver | rejected, reason "below-min-score" |
| Signal has no evidence (lexical-only) | RetrievalAcceptanceResolver | rejected, reason "missing-evidence" |
| Anchor not found in artifact map | EvidenceAttachmentValidator | `{ valid: false, reason: "Anchor not found: ..." }` |
| Anchor has no evidence mappings | EvidenceAttachmentValidator | `{ valid: false, reason: "No evidence mappings found..." }` |
| Evidence ID not in evidences map | EvidenceAttachmentValidator | `{ valid: false, reason: "No valid evidence found..." }` |
| Evidence validation fails | ResumeResolver | Signal excluded from output; logs via RetrievalLogger |
| Anchor node not in anchorMap | AtsSkillGroupCompiler | Signal silently skipped |
| Invalid adjacency target during build | AdjacencyProducer | Silently skipped (returns null, filtered out) |
| Disk I/O error reading artifacts | ArtifactLoader | Propagates `fs.readFile` error |
| Artifact cache not populated | ArtifactRegistry | Loads + hydrates on first `getArtifacts()` call |
| Evidence type not project/experience | ResumeResolver | Filtered out |
| Evidence score = 0 | ResumeResolver | Filtered out |
| Propagation reaches maxExpandedAnchors | PropagationEngine | Stops adding new entries, returns early |
| Tech anchor with no evidence (unmatched) | ResumeResolver enumeration | Skipped (requires evidence) |

---

## 11. Generated Artifact Schemas

All files stored in `dist/src/services/profile/artifacts/generated/` (via `ARTIFACT_OUTPUT_DIR`).

### anchors.json
JSON array of `[AnchorId, AnchorNode]` tuples (serialized Map):
```json
[
  ["cap.backend.api-development", {
    "id": "cap.backend.api-development",
    "kind": "cap",
    "category": "backend",
    "key": "api-development"
  }],
  ["tech.language.typescript", {
    "id": "tech.language.typescript",
    "kind": "tech",
    "category": "language",
    "key": "typescript"
  }]
]
```

### evidences.json
JSON array of `[EvidenceId, EvidenceNode]` tuples:
```json
[
  ["ev.project.0", {
    "id": "ev.project.0",
    "anchorIds": ["cap.backend.api-development"],
    "type": "project",
    "title": "Job Board Platform",
    "position": "Backend Developer",
    "startDate": "2024-01",
    "endDate": "2024-06",
    "summary": "Built a scalable job board...",
    "bullets": [
      { "text": "Designed and implemented RESTful APIs", "kind": "responsibility", "weight": 0.8 },
      { "text": "Reduced latency by 40%", "kind": "outcome", "weight": 1.0 }
    ],
    "links": {}
  }],
  ["ev.exp.1", {
    "id": "ev.exp.1",
    "anchorIds": ["cap.backend.api-development"],
    "type": "experience",
    "company": "Tech Corp",
    "position": "Senior Backend Engineer",
    "startDate": "2022-01",
    "endDate": "Present",
    "bullets": [...]
  }]
]
```

### surfaces.en.json / surfaces.vi.json
Two separate JSON arrays of `LexicalSurface`, one per language. Split at build time by the `language` field:
```json
[
  { "pattern": "rest api", "anchorId": "cap.backend.api-development", "language": "en", "source": "canonical", "weight": 1 },
  { "pattern": "develop and maintain rest api", "anchorId": "cap.backend.api-development", "language": "en", "source": "template", "weight": 0.8 },
  { "pattern": "aws api gateway", "anchorId": "cap.backend.api-development", "language": "en", "source": "vendor", "weight": 0.35 }
]
```
Note: all patterns are lowercased and boundary-wrapped when inserted into the AhoCorasick trie.

### adjacency.json
JSON array of `[AnchorId, AdjacencyEdge[]]` tuples:
```json
[
  ["cap.backend.api-development", [
    { "from": "cap.backend.api-development", "to": "cap.backend.system-design", "weight": 0.35 },
    { "from": "cap.backend.api-development", "to": "cap.backend.database-optimization", "weight": 0.35 }
  ]]
]
```

### anchor-to-evidence.json
JSON array of `[AnchorId, EvidenceId[]]` tuples (serialized nested set map):
```json
[
  ["cap.backend.api-development", ["ev.project.0", "ev.exp.1"]],
  ["tech.language.typescript", ["ev.project.0"]]
]
```

### metadata.json
```json
{
  "generatedAt": "2026-06-04T12:00:00.000Z",
  "version": 1
}
```
- `version` is defined by `ARTIFACT_VERSION` constant (= 1)
- `generatedAt` is set at build time

---

## 12. Singleton & Caching Strategy

| Singleton | File | State | Clearable | Thread-Safe |
|---|---|---|---|---|
| `ArtifactRegistry` | `artifacts/loaders/artifact-cache.ts` | Caches `HydratedArtifactBundle` | `static clearCache()` | Double-checked locking |
| `RetrievalLogger` | `retrieval/logging/retrieval-logger.ts` | Buffer of up to 1000 `RetrievalLogEntry` | `clearLogs()` | Not synchronized (single-threaded Node) |

### ArtifactRegistry initialization flow
```
getArtifacts() called
  -> hydratedBundle exists?         <- return cached
  -> isLoading AND loadingPromise?   <- return existing promise
  -> set isLoading = true
   -> ArtifactLoader.load()          <- reads 6 JSON files in parallel
   -> ArtifactHydrator.hydrate()     <- builds 2 AhoCorasick tries (en/vi)
  -> store in hydratedBundle
  -> clear isLoading/loadingPromise
  -> return bundle
```

---

## 13. Source Data Maps

### Canonical Skill Map (`resume/normalization/canonical-skill.map.ts`)

| Normalized Name (input) | Canonical Name (output) |
|---|---|
| `Rest Api` | `API Development` |
| `Http Api` | `API Development` |
| `Backend Api` | `API Development` |

Resolution: `SkillClusterResolver.resolve()` -> `normalizeAnchor(anchorNode)` -> lookup in `canonicalSkillMap` -> return mapped value or original.

### ATS Group Label Map (`resume/compiler/ats-skill-group.mapper.ts` — `mapCategoryToGroupLabel()`)

| Category | Group Label |
|---|---|
| `backend` | `Backend` |
| `architecture` | `Architecture` |
| `observability` | `Observability` |
| `infrastructure` | `Infrastructure` |
| `security` | `Security` |
| `communication` | `Communication` |
| `foundation` | `Fundamentals` |
| `testing` | `Testing` |
| `language` | `Languages` |
| `backend_framework` | `Frameworks` |
| `frontend_framework` | `Frameworks` |
| `protocol` | `Protocols` |
| `database` | `Databases` |

Unmapped categories fall through to their raw string value.

**Note:** `SkillKeyNormalizer.mapCategoryToLabel()` has a separate mapping used by `getCategoryOrder()`:
- `backend_framework` -> `'Backend'`
- `frontend_framework` -> `'Frontend'`
These are NOT used by the compiler; the compiler uses `AtsSkillGroupMapper.mapCategoryToGroupLabel()`.

### getSectionKind() (`ats-skill-group.mapper.ts`)

| Anchor Kind | Section | Effective ATS visibility |
|---|---|---|
| `tech` | Primary | visible |
| `cap` | Secondary (skipped by compiler) | hidden |
| `comp` | Secondary (skipped by compiler) | hidden |
| `beh` | Secondary (explicitly excluded in compiler) | hidden |

Note: The compiler only collects `'primary'` signals into its group map. Since `getSectionKind()` returns `'secondary'` for non-tech anchors, they are silently skipped. Additionally, `beh` anchors are explicitly excluded by `if (anchorNode.kind === 'beh') continue;` before the section check. The visibility policy (`retrievalPolicy.visibility`) is used by `ResumeResolver` for logging ATS exposure decisions, not by the compiler itself.

### getCategoryOrder() (`skill-key-normalizer.ts`)

Returns labels in order: `Backend`, `Languages`, `Databases`, `Infrastructure`, `Protocols`, `Testing`, `Frontend`, `Third Party`, `Architecture`, `Observability`, `Security`, `Fundamentals`, `Communication`.

Note: `getCategoryOrder()` is not used by the compiler. The compiler sorts groups alphabetically by label.

---

## 14. Lexical Template Strings

From `source/templates.source.ts`. Templates use `{surface}` placeholder.

Vendor template patterns from `vendorTemplates.source.ts` use `{retrieval_association}` placeholder and are generated for all 3 `TemplateKind` values in both languages.

### English Templates

**responsibility** (19 patterns):
```
"develop and maintain {surface}"
"design and implement {surface}"
"build reliable {surface}"
"build production-grade {surface}"
"support production-grade {surface}"
"integrate and operate {surface}"
"optimize and troubleshoot {surface}"
"monitor and optimize {surface}"
"improve reliability of {surface}"
"maintain scalable {surface}"
"build backend systems using {surface}"
"develop backend services for {surface}"
"design backend solutions for {surface}"
"design scalable backend architecture around {surface}"
"implement high-performance {surface}"
"develop high-availability {surface}"
"maintain distributed {surface}"
"collaborate on backend platform {surface}"
"participate in developing {surface}"
```

**requirement** (15 patterns):
```
"experience with {surface}"
"hands-on experience with {surface}"
"knowledge of {surface}"
"understanding of {surface}"
"practical experience with {surface}"
"good understanding of {surface}"
"experience building {surface}"
"experience operating {surface}"
"experience designing {surface}"
"experience deploying {surface}"
"ability to maintain {surface}"
"familiarity with {surface}"
"ability to troubleshoot {surface}"
"ability to optimize {surface}"
"experience working with {surface}"
```

**preference** (5 patterns):
```
"prior exposure to {surface}"
"experience with {surface} is a plus"
"knowledge of {surface} is preferred"
"experience operating large-scale {surface} is preferred"
"familiarity with distributed {surface} is a plus"
```

### Vietnamese Templates

**responsibility** (19 patterns):
```
"thiết kế và triển khai {surface}"
"phát triển và duy trì {surface}"
"xây dựng {surface} ổn định"
"xây dựng {surface} ở mức production"
"hỗ trợ vận hành {surface} ở production"
"tích hợp và vận hành {surface}"
"tối ưu và xử lý sự cố {surface}"
"giám sát và tối ưu {surface}"
"cải thiện độ tin cậy của {surface}"
"duy trì {surface} có khả năng mở rộng"
"xây dựng hệ thống backend với {surface}"
"phát triển dịch vụ backend cho {surface}"
"thiết kế giải pháp backend cho {surface}"
"thiết kế kiến trúc backend có khả năng mở rộng quanh {surface}"
"triển khai {surface} hiệu năng cao"
"phát triển {surface} sẵn sàng vận hành"
"duy trì {surface} phân tán"
"phối hợp phát triển nền tảng backend với {surface}"
"tham gia phát triển {surface}"
```

**requirement** (15 patterns):
```
"có kinh nghiệm với {surface}"
"có kinh nghiệm triển khai {surface}"
"có kiến thức về {surface}"
"hiểu biết về {surface}"
"có kinh nghiệm thực tế với {surface}"
"am hiểu về {surface}"
"có kinh nghiệm phát triển {surface}"
"có kinh nghiệm vận hành {surface}"
"có kinh nghiệm thiết kế {surface}"
"có kinh nghiệm triển khai production với {surface}"
"có khả năng duy trì {surface}"
"quen thuộc với {surface}"
"có khả năng xử lý sự cố {surface}"
"có khả năng tối ưu {surface}"
"đã từng làm việc với {surface}"
```

**preference** (5 patterns):
```
"đã từng tiếp xúc với {surface}"
"có kinh nghiệm với {surface} là lợi thế"
"ưu tiên ứng viên có kiến thức về {surface}"
"ưu tiên ứng viên từng vận hành {surface} quy mô lớn"
"quen thuộc với {surface} phân tán là lợi thế"
```

### Vendor Templates

**English** (`vendorTemplates.en`):
- **responsibility** (3): `"integrate with {retrieval_association}"`, `"operate with {retrieval_association}"`, `"support {retrieval_association} workflows"`
- **requirement** (3): `"experience with {retrieval_association}"`, `"working knowledge of {retrieval_association}"`, `"ability to integrate {retrieval_association}"`
- **preference** (2): `"exposure to {retrieval_association}"`, `"prior work with {retrieval_association}"`

**Vietnamese** (`vendorTemplates.vi`):
- **responsibility** (3): `"tích hợp với {retrieval_association}"`, `"vận hành với {retrieval_association}"`, `"hỗ trợ luồng {retrieval_association}"`
- **requirement** (3): `"có kinh nghiệm với {retrieval_association}"`, `"có hiểu biết về {retrieval_association}"`, `"có khả năng tích hợp {retrieval_association}"`
- **preference** (2): `"đã từng tiếp xúc với {retrieval_association}"`, `"đã từng làm việc với {retrieval_association}"`

---

## 15. Test Case Registry

### Unit Tests (18 files)

| File | Test Count | Area Tested |
|---|---|---|
| `tests/unit/profile/artifacts/anchor.producer.test.ts` | 6 | AnchorProducer — anchor generation from profile source |
| `tests/unit/profile/artifacts/evidence.producer.test.ts` | 9 | EvidenceProducer — evidence node creation, bullet building |
| `tests/unit/profile/artifacts/adjacency.producer.test.ts` | 4 | AdjacencyProducer — edge generation, missing target handling |
| `tests/unit/profile/artifacts/anchor-evidence.producer.test.ts` | 4 | AnchorEvidenceProducer — anchor-to-evidence mapping |
| `tests/unit/profile/artifacts/artifact-cache.test.ts` | 7 | ArtifactRegistry — singleton caching, double-checked locking |
| `tests/unit/profile/artifacts/artifact-hydrator.test.ts` | 4 | ArtifactHydrator — trie building from surface data |
| `tests/unit/profile/artifacts/map.serializer.test.ts` | 7 | MapSerializer — serialization/deserialization of Map/Set structures |
| `tests/unit/profile/bullet-selector.test.ts` | 3 | BulletSelector — topK sorting, default limit |
| `tests/unit/profile/match-signal-builder.test.ts` | 4 | MatchSignalBuilder — lexical hit scoring, saturation, confidence |
| `tests/unit/profile/evidence-attachment-validator.test.ts` | 4 | EvidenceAttachmentValidator — anchor/mapping/evidence checks |
| `tests/unit/profile/evidence-features-extractor.test.ts` | 6 | EvidenceFeaturesExtractor — keyword scoring per category |
| `tests/unit/profile/evidence-ranker.test.ts` | 4 | EvidenceRanker — weighted sum, non-negative guarantee |
| `tests/unit/profile/propagation-engine.test.ts` | 5 | PropagationEngine — edge propagation, depth limit, blocked kinds |
| `tests/unit/profile/ranking-features.test.ts` | 5 | RankingFeaturesExtractor — lexical/propagation/evidence scores |
| `tests/unit/profile/retrieval-ranker.test.ts` | 5 | RetrievalRanker — weighted sum, negative clamping, boundary thresholds |
| `tests/unit/profile/resolution-strength.test.ts` | 8 | ResolutionStrength — strong/partial/weak/missing classification |
| `tests/unit/profile/retrieval-acceptance-resolver.test.ts` | 5 | RetrievalAcceptanceResolver — threshold enforcement, evidence check |
| `tests/unit/profile/resume-resolver.test.ts` | 7 | ResumeResolver — skill acceptance/rejection, evidence filtering, traces |
| `tests/unit/profile/skill-key-normalizer.test.ts` | 7 | SkillKeyNormalizer — kebab/underscore normalization, category mapping |

**Unit total: 19 files, 104 tests**

### Integration Tests (4 files)

| File | Test Count | Flow Tested |
|---|---|---|
| `retrieval-pipeline.integration.test.ts` | 3 | Lexical hit produces signal, hit propagates through adjacency, propagated signals participate in ranking |
| `acceptance-validation.integration.test.ts` | 3 | Threshold enforced, no evidence rejected, evidence accepted |
| `resume-resolution.integration.test.ts` | 7 | Skills output, experience/projects ordering + cap, traces with resolution strength |
| `artifact-integrity.integration.test.ts` | 2 | Non-existent anchor skipped, invalid evidence rejected |

**Integration total: 4 files, 15 tests**

### Regression Tests (1 file)

| File | Test Count | Area Tested |
|---|---|---|
| `retrieval-regression.spec.ts` | 64 | Full pipeline snapshot tests against 8 corpus JDs; each tests retrieval output + resolve output + debug snapshots against expected values |

**Regression total: 1 file, 64 tests**

### Coverage Summary

| Layer | Files | Cases |
|---|---|---|
| Unit | 19 | 104 |
| Integration | 4 | 15 |
| Regression | 1 | 64 |
| **Total** | **24** | **183** |

### Coverage Gaps (components without dedicated tests)

| Component | File(s) | Risk |
|---|---|---|
| NormalizationPipeline | `retrieval/normalization.pipeline.ts` | **High** — foundation of all matching |
| RetrievalRanking (utils) | `retrieval/retrieval-ranking.ts` | **High** — used by ranker |
| ExpansionResolver (unit) | `retrieval/expansion-resolver.ts` | **High** — only covered via INT-014 |
| EvidenceResolver | `retrieval/evidence-resolver.ts` | **High** — bridges anchors to evidence |
| RetrievalLogger | `retrieval/logging/retrieval-logger.ts` | Medium — side-effect heavy |
| RetrievalDebugger | `retrieval/retrieval-debugger.ts` | Low — regression test helper |
| SkillClusterResolver | `resume/normalization/skill-cluster-resolver.ts` | Low — simple map lookup |
| AtsSkillGroupMapper | `resume/compiler/ats-skill-group.mapper.ts` | Low — static mapping |
| AtsSkillGroupCompiler (real) | `resume/compiler/ats-skill-group.compiler.ts` | Medium — only tested via mock |
| bootstrapRetrieval | `retrieval/retrieval-engine.ts` | Low — thin factory |
| All 6 ArtifactProducers | `artifacts/producers/*.ts` | Low — build-time only |
| All 3 ArtifactLoaders | `artifacts/loaders/*.ts` | Low — I/O infrastructure |
| MapSerializer | `artifacts/serializers/map.serializer.ts` | Low — simple transforms |
| ArtifactFileUtil | `artifacts/utils/artifact-file.util.ts` | Low — file I/O wrapper |
| ProfileInfoRetriever | `index.ts` | Low — thin facade |

---

## 16. Aho-Corasick Algorithm Details

### Data Structure
```
Node {
  children: Map<char, Node>    // trie transitions
  fail: Node | null            // failure link
  outputs: Output[]            // patterns ending at this node
}
```

### Insert
- Walk characters of normalized, boundary-wrapped pattern
- Create nodes as needed
- Append `{ anchorId, pattern, weight, source }` to final node's outputs

### BuildFallbackLinks
- BFS from root
- Root children -> fail = root
- For each node:
  - For each child at char `c`:
    - Walk `current.fail` chain until finding node with child at `c`
    - Set `child.fail` = that node's child, or root
  - Merge outputs from `child.fail` into `child.outputs`

### Traverse
- State machine walk character by character
- On each char:
  - Follow failure links if current node has no child at char
  - Transition to child node (or root)
  - For each output at current node: create/update MatchSignal via MatchSignalBuilder.appendLexicalHit
- Complexity: O(n + m + k) where n = text length, m = total pattern length, k = total output length

### Pattern Preparation (in AhoProducer)
Each surface pattern is transformed before insertion:
```
normalizer.boundaryWrap(normalizer.normalize(pattern.toLowerCase()))
// = " " + lowercase(pattern) + " "
```
This ensures substring matching works correctly (patterns are space-delimited).

---

## 17. Profiling & Performance Characteristics

| Operation | Complexity | Typical Size |
|---|---|---|
| AhoCorasick.buildFallbackLinks | O(total pattern length) | ~5000 chars |
| AhoCorasick.traverse | O(text length + total matches) | ~5000 chars text |
| PropagationEngine.walk | O(direct anchors * adjacency per anchor^maxDepth) | ~50 anchors * ~3 edges * 2 depth |
| EvidenceResolver.resolve | O(expanded anchors * avg evidence per anchor) | ~50 anchors * ~2 evidence |
| RetrievalRanker.rank (per signal) | O(1) feature extraction + O(evidenceIds) | ~5 evidence IDs |
| EvidenceFeaturesExtractor.extract | O(text length * keyword count) | ~500 chars * ~20 keywords |
| ArtifactLoader.load | 6 parallel file reads | ~50KB total |
| RetrievalLogger | O(1) append, capped at 1000 | <= 1000 entries |

---

## 18. File Reference

| Area | Directory | Key Files |
|---|---|---|
| Source data | `source/` | `profile.source.ts`, `relations.source.ts`, `templates.source.ts`, `source.types.ts` |
| Core types | `types/` | `retrieval.types.ts`, `resolve.types.ts` |
| Retrieval pipeline | `retrieval/` | `profile-retrieval-engine.ts`, `aho-corasick.ts`, `normalization.pipeline.ts`, `expansion-resolver.ts`, `evidence-resolver.ts`, `retrieval-engine.ts`, `retrieval-debugger.ts` |
| Scoring | `retrieval/scoring/` | `match-signal.builder.ts` |
| Propagation | `retrieval/propagation/` | `propagation-engine.ts` |
| Ranking | `retrieval/ranking/` | `retrieval-ranker.ts`, `ranking-features.ts`, `ranking-policy.ts` |
| Resolution | `retrieval/resolution/` | `resolution-strength.ts` |
| Acceptance | `retrieval/resolver/` | `retrieval-acceptance.resolver.ts` |
| Evidence | `retrieval/evidence/` | `evidence-feature-extractor.ts`, `evidence-ranker.ts`, `evidence-ranking-policy.ts` |
| Validation | `retrieval/validation/` | `evidence-attachment.validator.ts` |
| Logging | `retrieval/logging/` | `retrieval-logger.ts` |
| Debugging | `retrieval/` | `retrieval-debugger.ts` |
| Policy | `retrieval/policies/` | `retrieval.policy.ts` |
| Contracts | `retrieval/contracts/` | `retrieval.types.ts` |
| Resume resolution | `resume/resolve/` | `resume-resolver.ts`, `bullet-selector.ts` |
| Skill normalization | `resume/normalization/` | `skill-key-normalizer.ts`, `canonical-skill.map.ts`, `skill-cluster-resolver.ts` |
| ATS compilation | `resume/compiler/` | `ats-skill-group.compiler.ts`, `ats-skill-group.mapper.ts` |
| Artifact build | `artifacts/builders/` | `artifact.builder.ts` |
| Artifact producers | `artifacts/producers/` | `anchor.producer.ts`, `evidence.producer.ts`, `lexical-surface.producer.ts`, `adjacency.producer.ts`, `anchor-evidence.producer.ts`, `aho.producer.ts` |
| Artifact loaders | `artifacts/loaders/` | `artifact.loader.ts`, `artifact-cache.ts`, `artifact-hydrator.ts` |
| Serializers | `artifacts/serializers/` | `map.serializer.ts` |
| File utils | `artifacts/utils/` | `artifact-file.util.ts` |
| Constants | `artifacts/constants/` | `artifact.constants.ts` |
| Generated output | `dist/src/services/profile/artifacts/generated/` | `anchors.json`, `evidences.json`, `surfaces.en.json`, `surfaces.vi.json`, `adjacency.json`, `anchor-to-evidence.json`, `metadata.json` |
| Unit tests | `tests/unit/profile/` | 19 files (artifacts/ + 12 top-level specs) |
| Integration tests | `tests/integration/profile/` | 4 files |
| Regression tests | `tests/regression/profile/` | `retrieval-regression.spec.ts` |
| Test helpers | `tests/regression/profile/helpers/` | `run-pipeline.ts` |
