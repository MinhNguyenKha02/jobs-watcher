# Profile Service Specification

## 1. Architecture & Dependency Graph

```
[Source Data] (build-time)
  src/source/profile.source.ts     → ProfileSource
  src/source/relations.source.ts   → RelationsSource
  src/source/templates.source.ts   → Lexical templates
       │
       ▼
[Artifact Producers] (build-time, run once)
  AnchorProducer            → anchors.json
  EvidenceProducer          → evidences.json
   LexicalSurfaceProducer    → surfaces.en.json + surfaces.vi.json
  AdjacencyProducer         → adjacency.json
  AnchorEvidenceProducer    → anchor-to-evidence.json
       │
       ▼
[Artifact Loaders] (load-time, cached via ArtifactRegistry singleton)
   ArtifactLoader            → reads 6 JSON files (2 surface files)
   ArtifactHydrator          → builds 2 AhoCorasick tries (en/vi) from surfaces
       │
       ▼
[HydratedArtifactBundle]  { anchors, evidences, enSurfaces, viSurfaces, adjacency, anchorToEvidence, aho: { en, vi } }
       │
       ▼
[ProfileRetrievalEngine.retrieve(jobText)]  (retrieval pipeline)
  1. detectLanguage(jobText)          → 'en' | 'vi'
  2. NormalizationPipeline.prepare()
  3. aho[lang].traverse()             → direct matches
  3. ExpansionResolver.expand()       → expanded matches
  4. EvidenceResolver.resolve()       → evidence scores
       │
       ▼
[RetrievalOutput]  { direct, expanded, evidences }
       │
       ▼
[ResumeResolver.resolve()]  (resolution pipeline)
  1. RetrievalRanker.rank() per signal       → RankedSignal { finalScore, resolutionStrength }
  2. EvidenceAttachmentValidator.validate()  → ValidationResult
  3. RetrievalAcceptanceResolver.accept()    → RetrievalAcceptance
  4. AtsSkillGroupCompiler.compile()         → AtsSkillSection (grouped)
  5. Filter/sort evidences → experience/projects
       │
       ▼
[ResumeSections]  { skills: AtsSkillSection, experience: EvidenceScore[], projects: EvidenceScore[], traces }
```

### Dependency Direction
```
Source files      →  Producers      →  JSON artifacts
JSON artifacts    →  Loaders        →  HydratedArtifactBundle
Bundle            →  RetrievalEngine →  RetrievalOutput
RetrievalOutput   →  ResumeResolver  →  ResumeSections
```

### Stateless vs Cached
| Component | State | Lifetime |
|---|---|---|
| ArtifactProducers | Stateless | Per-build |
| ArtifactLoader | Stateless | Per-load |
| ArtifactRegistry | Singleton, cached | Process lifetime |
| AhoCorasick tries (en/vi) | Immutable after build | Process lifetime |
| ProfileRetrievalEngine | Stateless (holds ref to bundle) | Per-request |
| ExpansionResolver | Stateless | Per-call |
| EvidenceResolver | Stateless | Per-call |
| RetrievalRanker | Stateless | Per-signal |
| ResumeResolver | Stateless (owns ranker/validator) | Per-request |
| RetrievalLogger | Singleton, mutable buffer | Process lifetime |

---

## 2. Pipeline: Step-by-Step Orchestration

### ProfileRetrievalEngine.retrieve(jobText: string): RetrievalOutput

| Step | Component | Class.Method | Input | Output | Side Effects |
|---|---|---|---|---|---|---|
| 1 | ProfileRetrievalEngine | `detectLanguage(text)` | raw jobText string | `'en'` or `'vi'` | None |
| 2 | NormalizationPipeline | `prepare(text)` | raw jobText string | normalized + boundary-wrapped string | None |
| 3 | AhoCorasick (per lang) | `traverse(text)` | prepared string | `Map<AnchorId, MatchSignal>` (direct) | None |
| 4 | ExpansionResolver | `expand(matches, adjacency)` | direct + AdjacencyMap | `Map<AnchorId, MatchSignal>` (expanded) | Mutates direct signal traces |
| 5 | EvidenceResolver | `resolve(expanded)` | expanded + evidences + anchorToEvidence | `RetrievalEvidenceScore[]` sorted desc | None |

### ResumeResolver.resolve(retrieval: RetrievalOutput, artifacts: HydratedArtifactBundle, jobId?: string)

| Step | Component | Class.Method | Input | Output | Side Effects |
|---|---|---|---|---|---|
| 1 | RetrievalRanker | `rank(signal, direct, expanded, evidences)` | signal + maps | `RankedSignal { finalScore, resolutionStrength }` | None |
| 2 | EvidenceAttachmentValidator | `validate(signal, artifacts, jobId)` | signal + bundle + jobId | `ValidationResult { valid, reason? }` | Logs via RetrievalLogger on failure |
| 3 | RetrievalAcceptanceResolver | `accept(signal, scoreToUse?)` | signal + optional score | `RetrievalAcceptance { accepted, reason, score }` | None |
| 4 | AtsSkillGroupCompiler | `compile(acceptedSignals, anchorMap)` | signals + anchor map | `AtsSkillSection { primary: [], secondary?: [] }` | None |
| 5 | ResumeResolver | resolve (orchestration) | retrieval + bundle | `{ skills, experience, projects, traces }` | Logs acceptance + ATS exposure |

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
  title: string
  organization?: string
  period?: string
  summary?: string
  bullets: EvidenceBullet[]
  technologies?: string[]
  links?: string[]
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

interface RetrievalResult {  // same shape as RetrievalOutput
  direct: Map<AnchorId, MatchSignal>
  expanded: Map<AnchorId, MatchSignal>
  evidences: RetrievalEvidenceScore[]
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
  period: string
  type: string
  anchor: { cap?, comp?, beh?, tech? }
  summary?: string
  responsibilities: string[]
  outcomes: string[]
  tech: string[]
  status?: string
  evidences?: string[]
}

interface ExperienceSource {
  company: string
  position: string
  location?: string
  startDate: string
  endDate?: string
  anchor: { cap?, comp?, beh?, tech? }
  responsibilities: string[]
  outcomes: string[]
  tech: string[]
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
  experience?: ExperienceSource[]
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

### From `retrieval-logger.ts`

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

### From `resume/compiler/ats-skill.compiler.ts` (flat variant)

```typescript
interface AtsSkillSection {
  primary: { capabilities: string[]; technologies: string[] }
  secondary?: { engineering: string[] }
}
```

### From `explainability/explainability-trace.ts`

```typescript
interface ExplainabilityTrace {
  anchorId: string
  score: number
  confidence: number
  matchedPatterns: string[]
  traces: string[]
}
```

---

## 4. I/O Contracts (per exported component)

### ProfileRetrievalEngine
- **File:** `retrieval/profile-retrieval-engine.ts`
- **Constructor:** `(artifacts: HydratedArtifactBundle)`
- **Methods:**
  - `detectLanguage(text: string): 'en' | 'vi'` — scans for Vietnamese Unicode range `[\u0102\u0103\u0110\u0111\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EF9]`; returns `'vi'` on match, `'en'` otherwise
  - `retrieve(jobText: string): RetrievalOutput` — runs detectLanguage → normalize → `aho[lang].traverse()` → expand → resolve
  - Never throws (empty maps on no match)

### NormalizationPipeline
- **File:** `retrieval/normalization.pipeline.ts`
- **Methods:**
  - `normalize(text: string): string` — lowercase → NFKC → strip non-`[a-z0-9+#.\-/\s]` → collapse whitespace → trim
  - `tokenize(text: string): string[]` — normalize + split on space
  - `boundaryWrap(text: string): string` — `" " + normalize(text) + " "`
  - `prepare(text: string): string` — normalize then boundaryWrap (double-wraps)

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
  - Iterates direct matches, propagates `signal.score * edge.weight` to existing adjacent signals
  - Only propagates to anchors already in `matches` (skips un-matched adjacency targets)
  - Mutates source signal trace via `appendPropagation`

### EvidenceResolver
- **File:** `retrieval/evidence-resolver.ts`
- **Constructor:** `(evidences: Map<EvidenceId, EvidenceNode>, anchorToEvidence: AnchorToEvidenceMap)`
- **Method:**
  - `resolve(signals: Map<AnchorId, MatchSignal>): RetrievalEvidenceScore[]`
  - Sums `signal.score` per evidenceId across all matched anchors
  - Returns sorted descending by score

### EvidenceAttachmentValidator
- **File:** `retrieval/validation/evidence-attachment.validator.ts`
- **Method:**
  - `validate(signal: MatchSignal, artifacts: HydratedArtifactBundle, jobId: string): ValidationResult`
  - Checks: (1) anchor exists, (2) anchor has evidence mappings, (3) at least one evidenceId exists in map
  - Logs `evidence-attachment-missing` on any failure

### RetrievalAcceptanceResolver
- **File:** `retrieval/resolver/retrieval-acceptance.resolver.ts`
- **Constructor:** `(policy: RetrievalPolicy)`
- **Methods:**
  - `accept(signal: MatchSignal, scoreToUse?: number): RetrievalAcceptance`
  - `sort(signals: Map<AnchorId, MatchSignal>): MatchSignal[]` — by score desc

### RetrievalRanker
- **File:** `retrieval/ranking/retrieval-ranker.ts`
- **Method:**
  - `rank(signal, directSignals, expandedSignals, evidences): RankedSignal`
  - Computes weighted sum of 7 features, clamps to ≥0, classifies resolution strength

### RankingFeaturesExtractor
- **File:** `retrieval/ranking/ranking-features.ts`
- **Static method:**
  - `extract(signal, directSignals, expandedSignals, evidences): RankingFeatures`
  - `adjacencyConfidence` and `atsVisibilityWeight` are **always 0** (not yet implemented)

### MatchSignalBuilder
- **File:** `retrieval/scoring/match-signal.builder.ts`
- **Constructor:** `(policy: RetrievalPolicy)`
- **Methods:**
  - `create(anchorId: AnchorId): MatchSignal` — initializes empty signal with score=0, confidence=0, occurrences=0
  - `finalize(signal: MatchSignal): void` — computes `confidence = min(1, (score*0.6 + occurrences*0.15 + sources.size*0.25) / 5)`
  - `appendLexicalHit({ signal, pattern, source, weight, start, end }): void` — increments score with saturation
  - `appendPropagation({ signal, from, weight }): void` — adds weight directly to score, adds trace

### PropagationEngine
- **File:** `retrieval/propagation/propagation-engine.ts`
- **Constructor:** `(policy, adjacency, builder?)`
- **Method:**
  - `propagate(direct): Map<AnchorId, MatchSignal>` — recursive graph walk, respects maxDepth/blockedKinds/minEdgeWeight/maxExpandedAnchors

### EvidenceRanker
- **File:** `retrieval/evidence/evidence-ranker.ts`
- **Static method:**
  - `scoreEvidence(evidence: EvidenceNode): number` — weighted sum of 4 feature scores

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
  - `resolve(retrieval, artifacts, jobId?)` — ranks → validates → accepts → compiles skills → filters experience/projects → builds traces

### BulletSelector
- **File:** `resume/resolve/bullet-selector.ts`
- **Method:**
  - `topK(bullets: string[], limit = 4): string[]` — sort by length desc, take top K

### SkillKeyNormalizer
- **File:** `resume/normalization/skill-key-normalizer.ts`
- **Static methods:**
  - `normalizeSkillName(key: string): string` — split on `[-_]`, capitalize first letter of each part, join with space
  - `mapCategoryToLabel(category: string): string` — maps category key to human-readable label (e.g., `'backend'` → `'Backend'`); falls through to `normalizeSkillName` on unknown
  - `getCategoryOrder(): string[]` — returns ordered list of category labels for deterministic output

### SkillClusterResolver
- **File:** `resume/normalization/skill-cluster-resolver.ts`
- **Method:**
  - `resolve(anchorNode): string` — normalizes anchor key, looks up in canonicalSkillMap, returns canonical or normalized

### AtsSkillGroupCompiler
- **File:** `resume/compiler/ats-skill-group.compiler.ts`
- **Method:**
  - `compile(acceptedSignals, anchorMap): AtsSkillSection` — groups by category, applies visibility, canonicalizes names, sorts groups and skills

### AtsSkillGroupMapper
- **File:** `resume/compiler/ats-skill-group.mapper.ts`
- **Static methods:**
  - `mapCategoryToGroupLabel(category): string` — maps e.g., `'backend'` → `'Backend'`
  - `getSectionKind(kind): 'primary' | 'secondary'`

### bootstrapRetrieval
- **File:** `retrieval/retrieval-engine.ts`
- **Async function:**
  - `bootstrapRetrieval(): Promise<ProfileRetrievalEngine>` — loads + caches artifacts, creates engine

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
  - `load(): Promise<ArtifactBundle>` — reads 7 JSON files in parallel (6 artifacts + metadata), deserializes Map/Set structures

### ArtifactHydrator
- **File:** `artifacts/loaders/artifact-hydrator.ts`
- **Method:**
  - `hydrate(artifacts: ArtifactBundle): HydratedArtifactBundle` — builds 2 AhoCorasick tries from `enSurfaces` (→ `aho.en`) and `viSurfaces` (→ `aho.vi`) via AhoProducer

### AnchorProducer
- **File:** `artifacts/producers/anchor.producer.ts`
- **Method:**
  - `produce(profile: ProfileSource): Map<AnchorId, AnchorNode>` — iterates `cap/comp/beh/tech` sections, creates `section.category.value` → `{ id, kind, category, key }`

### EvidenceProducer
- **File:** `artifacts/producers/evidence.producer.ts`
- **Method:**
  - `produce(profile: ProfileSource): Map<EvidenceId, EvidenceNode>` — iterates projects + experience, builds bullets (responsibility weight=0.8, outcome weight=1.0)

### LexicalSurfaceProducer
- **File:** `artifacts/producers/lexical-surface.producer.ts`
- **Method:**
  - `produce(relations: RelationsSource): { en: LexicalSurface[]; vi: LexicalSurface[] }` — generates canonical (weight=1), template (weight=0.8), vendor (weight=0.35) surfaces, splits by language at output
  - Template patterns built for all 3 `TemplateKind` values: `responsibility`, `requirement`, `preference`
  - Vendor surfaces include raw vendor names (both languages) + vendor template patterns (`vendorTemplates[lang][kind]` × `{retrieval_association}` for all 3 kinds, both languages)

### AdjacencyProducer
- **File:** `artifacts/producers/adjacency.producer.ts`
- **Constructor:** `(validAnchors: Set<AnchorId>)`
- **Method:**
  - `produce(relations: RelationsSource): AdjacencyMap` — creates edges with weight 0.35
  - Target resolution: same-category → same-kind (all categories) → all kinds (fallback)
  - Missing targets (no valid anchor) are silently skipped (no throw)

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
  - `captureDebug(retrieval: RetrievalOutput, result?): DebugSnapshot` — converts retrieval pipeline output to human-readable debug snapshot with matched anchors, propagated anchors, evidence scores, and resolved traces
- **Used by:** regression test pipeline (`tests/regression/profile/helpers/run-pipeline.ts`)

---

## 5. Policy Constraints (exhaustive)

### RetrievalPolicy (`retrieval/policies/retrieval.policy.ts`)

| Path | Key | Value | Description |
|---|---|---|---|
| `direct` | `minScore` | `0.2` | Minimum score for a direct match before it can participate in propagation |
| `direct` | `occurrenceSaturation` | `4` | After N same-pattern occurrences, diminishing returns max |
| `direct.sourceWeights` | `canonical` | `1.0` | Weight multiplier for canonical source matches |
| `direct.sourceWeights` | `adjacent` | `0.55` | Weight multiplier for adjacent source matches |
| `direct.sourceWeights` | `vendor` | `0.35` | Weight multiplier for vendor source matches |
| `direct.sourceWeights` | `template` | `0.8` | Weight multiplier for template source matches |
| `direct.stageWeights` | `lexical` | `1.0` | Weight multiplier for lexical stage |
| `direct.stageWeights` | `propagation` | `0.65` | Weight multiplier for propagation stage |
| `propagation` | `enabled` | `true` | Whether propagation is active |
| `propagation` | `maxDepth` | `2` | Max graph walk depth from direct match |
| `propagation` | `minEdgeWeight` | `0.2` | Edges below this weight are ignored |
| `propagation` | `decayFactor` | `0.72` | Score multiplier applied per hop |
| `propagation` | `maxExpandedAnchors` | `32` | Cap on unique anchor entries in expanded map |
| `propagation.blockedKinds` | — | `['beh']` | Anchor kinds that never propagate |
| `resolver` | `minAcceptedScore` | `0.55` | Minimum `finalScore` to accept a signal for resume output |
| `resolver` | `maxSkills` | `18` | Maximum skills in output (not implemented in compiler) |
| `resolver` | `maxProjects` | `2` | Maximum project evidence entries |
| `resolver` | `maxExperience` | `2` | Maximum experience evidence entries |
| `resolver` | `requireEvidenceForSkills` | `true` | Reject lexical-only signals without evidence IDs |
| `visibility` | `cap` | `'primary'` | Capability anchors → primary ATS section |
| `visibility` | `tech` | `'primary'` | Technology anchors → primary ATS section |
| `visibility` | `comp` | `'secondary'` | Competency anchors → secondary ATS section |
| `visibility` | `beh` | `'hidden'` | Behavioral anchors → excluded from ATS output |
| `resolution` | `strongThreshold` | `0.7` | Score ≥ this + direct evidence → strong |
| `resolution` | `partialThreshold` | `0.4` | Score ≥ this → partial |
| `resolution` | `weakThreshold` | `0.2` | Score ≥ this → weak |
| `resolution` | `missingThreshold` | `0.0` | Below this → missing |

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
weighted = rawWeight × sourceWeight[source] × stageWeights.lexical
saturation = min(1, occurrences / occurrenceSaturation)
effective = weighted × (1 - saturation × 0.45)
signal.score += effective
```

**Example:** canonical hit, rawWeight=2.0, occurrenceSaturation=4, 1st occurrence:
```
weighted    = 2.0 × 1.0 (canonical) × 1.0 (lexical) = 2.0
saturation  = min(1, 1/4) = 0.25
effective   = 2.0 × (1 - 0.25 × 0.45) = 2.0 × 0.8875 = 1.775
```

**Diminishing returns example:** same pattern, 4th occurrence:
```
saturation = min(1, 4/4) = 1.0
effective  = 2.0 × (1 - 1.0 × 0.45) = 2.0 × 0.55 = 1.1
```

### MatchSignalBuilder.appendPropagation
```
signal.score += weight      // weight added directly
signal.stages.add('propagation')
```

### MatchSignalBuilder.finalize
```
confidence = min(1, (score × 0.6 + occurrences × 0.15 + sources.size × 0.25) / 5)
```

### PropagationEngine.propagate (per edge, at depth d)
```
propagated = sourceSignal.score × edgeWeight × decayFactor
// decayFactor = 0.72, applied once regardless of depth
// (note: decayFactor is NOT compounded — formula is score × weight × 0.72)
```

**Example:** sourceSignal.score=1.0, edgeWeight=0.5, depth=1:
```
propagated = 1.0 × 0.5 × 0.72 = 0.36
```

**Additional guards in walk():**
- Skip if `depth >= maxDepth` (2)
- Skip if `edgeWeight < minEdgeWeight` (0.2)
- Skip if `propagated < minScore` (0.2)
- Skip if `expanded.size >= maxExpandedAnchors` (32)
- Skip if `kind` is in `blockedKinds` (`['beh']`)
- Skip if `origin:target:depth` already visited

### RetrievalRanker.rank
```
rawScore =
  lexicalScore × 0.35 +
  propagationScore × 0.25 +
  evidenceScore × 0.20 +
  sourceDiversity × 0.10 +
  occurrenceScore × 0.05 +
  adjacencyConfidence × 0.03 +
  atsVisibilityWeight × 0.02

finalScore = max(0, rawScore)
```

### EvidenceRanker.scoreEvidence
```
score = max(0,
  operational × 0.30 +
  architecture × 0.30 +
  ownership × 0.20 +
  quantified × 0.20)
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
boostExact(s, n)  = s + n × 0.15
penalizeDup(s, n) = s / (1 + n × 0.2)
```

### EvidenceResolver.resolve
```
For each signal:
  for each evidenceId in anchorToEvidence[signal.anchorId]:
    evidenceScore[evidenceId] += signal.score
Return sorted by score descending
```

---

## 7. Resolution Classification Rules

### classifyResolutionStrength(finalScore, signal, policy)

```
hasDirectEvidence = signal.stages.has('lexical')
                    AND (!signal.stages.has('propagation') OR signal.stages.size > 1)

if finalScore >= 0.7 AND hasDirectEvidence           → 'strong'
else if finalScore >= 0.4                             → 'partial'
else if finalScore >= 0.2                             → 'weak'
else                                                  → 'missing'
```

| Condition | Resolution | Description |
|---|---|---|
| finalScore ≥ 0.7 AND has lexical evidence (not propagation-only) | strong | Direct evidence with high confidence score |
| finalScore ≥ 0.4 | partial | Good lexical match with limited direct evidence |
| finalScore ≥ 0.2 | weak | Propagation-derived or vendor-only match |
| finalScore < 0.2 | missing | Required signal not found in retrieval |
| finalScore ≥ 0.7 BUT propagation-only | NOT strong (falls to partial or below) | Cannot be strong without direct evidence |

Note: `hasDirectEvidence` means the signal has a `lexical` stage AND is not exclusively `propagation` (either no propagation stage, or has additional stages beyond propagation).

### isSignalViable(signal, policy)
```
return signal.score >= policy.resolution.weakThreshold  // score >= 0.2
```

### getResolutionStrengthDescription
```
strong  → 'Direct evidence with high confidence score'
partial → 'Good lexical match with limited direct evidence'
weak    → 'Propagation-derived or vendor-only match'
missing → 'Required signal not found in retrieval'
```

---

## 8. Acceptance Rules

### RetrievalAcceptanceResolver.accept(signal, scoreToUse?)

```
score = scoreToUse ?? signal.score

if score < policy.resolver.minAcceptedScore (0.55):
    → { accepted: false, reason: 'below-min-score', score }

if policy.resolver.requireEvidenceForSkills (true)
   AND signal.evidenceIds.size === 0
   AND NOT signal.stages.has('propagation'):    // lexical-only with no evidence
    → { accepted: false, reason: 'missing-evidence', score }

→ { accepted: true, reason: 'accepted', score }
```

Decision table:

| Score ≥ 0.35? | Has evidenceIds? | Propagation-only? | Result |
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
- `40%` → 1 match (percentage)
- `200ms` → 1 match (milliseconds)
- `10k` → 1 match (thousands)
- `200`, `40`, `10` → 3 matches (numbers)
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
| Propagation depth ≥ maxDepth | PropagationEngine | Returns, no further edge processing |
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
| Evidence with `type` not project/experience | ResumeResolver private methods | Filtered out by `filter(item => item.evidence?.type === ...)` |
| Evidence score = 0 | ResumeResolver private methods | Filtered out by `filter(item => item.score > 0)` |
| Propagation engine reaches maxExpandedAnchors | PropagationEngine | Stops adding new entries, returns early |

---

## 11. Generated Artifact Schemas

All files stored in `src/services/profile/artifacts/generated/`.

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
    "period": "2024-01 - 2024-06",
    "summary": "Built a scalable job board...",
    "bullets": [
      { "text": "Designed and implemented RESTful APIs", "kind": "responsibility", "weight": 0.8 },
      { "text": "Reduced latency by 40%", "kind": "outcome", "weight": 1.0 }
    ],
    "technologies": ["Node.js", "PostgreSQL"],
    "links": []
  }],
  ["ev.exp.1", {
    "id": "ev.exp.1",
    "anchorIds": ["cap.backend.api-development"],
    "type": "experience",
    "organization": "Tech Corp",
    "title": "Senior Backend Engineer",
    "period": "2022-01 - Present",
    "bullets": [...],
    "technologies": ["TypeScript", "AWS"]
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
  → hydratedBundle exists?         ← return cached
  → isLoading AND loadingPromise?   ← return existing promise
  → set isLoading = true
   → ArtifactLoader.load()          ← reads 7 JSON files in parallel
   → ArtifactHydrator.hydrate()     ← builds 2 AhoCorasick tries (en/vi)
  → store in hydratedBundle
  → clear isLoading/loadingPromise
  → return bundle
```

---

## 13. Source Data Maps

### Canonical Skill Map (`resume/normalization/canonical-skill.map.ts`)

| Normalized Name (input) | Canonical Name (output) |
|---|---|
| `Rest Api` | `API Development` |
| `Http Api` | `API Development` |
| `Backend Api` | `API Development` |

Resolution: `SkillClusterResolver.resolve()` → `normalizeAnchor(anchorNode)` → lookup in `canonicalSkillMap` → return mapped value or original.

### ATS Group Label Map (`resume/compiler/ats-skill-group.mapper.ts`)

| Category | Group Label |
|---|---|
| `backend` | `Backend` |
| `architecture` | `Architecture` |
| `observability` | `Observability` |
| `infrastructure` | `Infrastructure` |
| `security` | `Security` |
| `communication` | `Communication` |
| `language` | `Languages` |
| `backend_framework` | `Frameworks` |
| `frontend_framework` | `Frameworks` |
| `database` | `Databases` |

Unmapped categories fall through to their raw string value (capitalized).

### Section Kind Map (`getSectionKind()`)

| Anchor Kind | Section | Visibility |
|---|---|---|
| `cap` | Primary | visible |
| `tech` | Primary | visible |
| `comp` | Secondary | visible |
| `beh` | Secondary (but excluded by compiler) | hidden |

Note: `beh` anchors are excluded by `AtsSkillGroupCompiler` via `if (anchorNode.kind === 'beh') continue;` before they reach `getSectionKind()`.

---

## 14. Lexical Template Strings

From `source/templates.source.ts`. Templates use `{surface}` placeholder.

Vendor template patterns from `vendorTemplates.source.ts` use `{retrieval_association}` placeholder and are generated for all 3 `TemplateKind` values in both languages.

### English Templates

**responsibility** (27 patterns):
```
"develop and maintain {surface}"
"design and implement {surface}"
"build scalable {surface}"
"optimize and troubleshoot {surface}"
"integrate and operate {surface}"
"participate in developing {surface}"
"support production-grade {surface}"
"implement high-performance {surface}"
"maintain reliable {surface}"
"build backend systems using {surface}"
"develop backend services for {surface}"
"design scalable backend architecture around {surface}"
"build and maintain RESTful {surface}"
"design backend solutions for {surface}"
"implement scalable microservice-based {surface}"
"develop high-availability {surface}"
"maintain distributed {surface}"
"collaborate on backend platform {surface}"
"improve reliability of {surface}"
"monitor and optimize {surface}"
```

**requirement** (16 patterns):
```
"experience with {surface}"
"knowledge of {surface}"
"understanding of {surface}"
"hands-on experience with {surface}"
"familiarity with {surface}"
"ability to troubleshoot {surface}"
"ability to optimize {surface}"
"experience building {surface}"
"experience operating {surface}"
"good understanding of {surface}"
"practical experience with {surface}"
"experience designing {surface}"
"experience deploying {surface}"
"ability to maintain {surface}"
"experience working with {surface}"
```

**preference** (5 patterns):
```
"experience with {surface} is a plus"
"prior exposure to {surface}"
"knowledge of {surface} is preferred"
"experience operating large-scale {surface} is preferred"
"familiarity with distributed {surface} is a plus"
```

### Vietnamese Templates

**responsibility** (18 patterns):
```
"phát triển và duy trì {surface}"
"thiết kế và triển khai {surface}"
"xây dựng và tối ưu {surface}"
"tham gia phát triển {surface}"
"vận hành và giám sát {surface}"
"xây dựng hệ thống backend với {surface}"
"tối ưu hiệu năng cho {surface}"
"triển khai và bảo trì {surface}"
"phát triển dịch vụ backend cho {surface}"
"xây dựng hệ thống có khả năng mở rộng với {surface}"
"xây dựng và phát triển RESTful {surface}"
"thiết kế kiến trúc backend cho {surface}"
"xây dựng hệ thống microservices cho {surface}"
"duy trì và tối ưu {surface}"
"tích hợp hệ thống với {surface}"
"xử lý và vận hành {surface}"
"phối hợp phát triển {surface}"
"giám sát và cải thiện {surface}"
```

**requirement** (13 patterns):
```
"có kinh nghiệm với {surface}"
"hiểu biết về {surface}"
"có kiến thức về {surface}"
"có khả năng xử lý {surface}"
"sử dụng được {surface}"
"có kinh nghiệm triển khai {surface}"
"có khả năng tối ưu {surface}"
"có kinh nghiệm phát triển {surface}"
"có kinh nghiệm vận hành {surface}"
"am hiểu về {surface}"
"có khả năng bảo trì {surface}"
"đã từng làm việc với {surface}"
"có khả năng xử lý sự cố liên quan đến {surface}"
```

**preference** (5 patterns):
```
"có kinh nghiệm với {surface} là lợi thế"
"ưu tiên ứng viên có kinh nghiệm {surface}"
"từng làm việc với {surface} là điểm cộng"
"có hiểu biết về hệ thống {surface} là lợi thế"
"ưu tiên ứng viên từng triển khai {surface}"
```

---

## 15. Test Case Registry

### Unit Tests (12 files, 60 test cases)

| File | Spec ID | Test Name | Constraint/Behavior Tested |
|---|---|---|---|
| `bullet-selector.spec.ts` | Bullet-001 | topK returns longest bullets | Sorts by length descending, returns top K |
| | Bullet-002 | topK default limit | Defaults to limit=4 |
| | Bullet-003 | fewer bullets than limit | Returns all when fewer than limit |
| `match-signal-builder.spec.ts` | Signal-001 | Single lexical hit | Score = weight × sourceWeight × stageWeight × (1 - sat) |
| | Signal-002 | Occurrence saturation | Diminishing returns on repeated same hits |
| | Signal-003 | Propagation append | Stage added, trace recorded |
| | Signal-004 | Confidence finalization | 0 ≤ confidence ≤ 1 |
| `evidence-attachment-validator.spec.ts` | Attachment-001 | Anchor missing | Returns invalid, logs error |
| | Attachment-002 | No mapping | Returns invalid when anchor has no evidence mappings |
| | Attachment-003 | Evidence missing | Returns invalid when evidence doesn't exist in map |
| | Attachment-004 | Valid mapping | Returns valid for complete chain |
| `evidence-features-extractor.spec.ts` | Feature-001 | Operational keywords | Score > 0 when operational keywords present |
| | Feature-002 | Architecture keywords | Score > 0 when architecture keywords present |
| | Feature-003 | Ownership keywords | Score > 0 when ownership keywords present |
| | Feature-004 | Quantified metrics | Score > 0 when numbers/percentages present |
| | Feature-005 | Score cap | quantifiedScore ≤ 1 |
| | (edge case) | No matches | All scores = 0 |
| `evidence-ranker.spec.ts` | Evidence-001 | All features = 1 | Score = 1.0 |
| | Evidence-002 | All features = 0 | Score = 0 |
| | (unnamed) | Non-negative | Score ≥ 0 |
| | (unnamed) | Weight usage | Only operational → score = 0.3 |
| `propagation-engine.spec.ts` | Prop-001 | Single edge | A→B resolves with correct score |
| | Prop-002 | Decay formula | score × edgeWeight × decayFactor |
| | Prop-003 | Depth limit | maxDepth=2 stops at depth 2 |
| | Prop-004 | Blocked kinds | 'beh' kind not propagated |
| | Prop-005 | Min edge weight | Edges < minEdgeWeight ignored |
| `ranking-features.spec.ts` | Feat-001 | Lexical score from direct | Uses direct signal score |
| | Feat-002 | No direct → lexical 0 | Returns 0 when no direct signal |
| | Feat-003 | Propagation = expanded − direct | Correct delta |
| | Feat-004 | Propagation-only | Entire expanded score → propagation |
| | Feat-005 | Source diversity | Counts unique sources |
| `retrieval-ranker.spec.ts` | Rank-001 | Lexical only | Score = lexicalScore × lexicalWeight |
| | Rank-002 | Lexical + evidence | Higher score than lexical-only |
| | Rank-003 | Propagation only | Lexical=0, propagation > 0 |
| | Rank-004 | Negative features | Ensures finalScore ≥ 0 |
| | Rank-005 | Boundary validation | Correct strong/partial/weak/missing at thresholds |
| `resolution-strength.spec.ts` | Res-001 | Strong | Score ≥ 0.7 + direct evidence |
| | Res-002 | Partial | Score ≥ 0.4, < 0.7 |
| | Res-003 | Weak | Score ≥ 0.2, < 0.4 |
| | Res-004 | Missing | Score < 0.2 |
| | Res-005 | Propagation-only not strong | High score but no direct evidence |
| | Res-006 | isSignalViable | True when score ≥ weakThreshold |
| | Res-007 | Description strings | Returns correct human-readable strings |
| `retrieval-acceptance-resolver.spec.ts` | Accept-001 | Score below threshold | 0.34 rejected |
| | Accept-002 | Score at threshold | 0.35 accepted |
| | Accept-003 | No evidence | Lexical-only with no evidence rejected |
| | Accept-004 | Propagation-only | Propagation-only without evidence still accepted |
| | (unnamed) | scoreToUse | Overrides signal.score |
| `resume-resolver.spec.ts` | Resume-001 | Accepted skill | Emitted in skills section |
| | Resume-002 | Rejected skill | Not emitted |
| | Resume-003 | Failed validation | Filtered out, logged |
| | Resume-004 | Experience ordering | Sorted by score desc |
| | Resume-005 | Max experience | Capped by policy |
| | (unnamed) | Projects ordering+limit | Sorted by score desc, capped by policy |
| | (unnamed) | Traces resolution | Resolution strength attached to traces |
| `skill-key-normalizer.test.ts` | Norm-001 | Kebab-case to title case | `event-driven-processing` → `Event Driven Processing` |
| | Norm-002 | Single word | `typescript` → `Typescript` |
| | Norm-002b | Underscore separator | `backend_framework` → `Backend Framework` |
| | Norm-004 | Mixed case | `API-Development` → `Api Development` |
| | Norm-005 | mapCategoryToLabel known | `backend` → `Backend` |
| | Norm-006 | mapCategoryToLabel unknown | falls through to normalizeSkillName |
| | Norm-007 | getCategoryOrder | Returns ordered labels |

### Integration Tests (4 files, 15 test cases)

| File | Spec ID | Test Name | Flow Tested |
|---|---|---|---|
| `retrieval-pipeline.integration.spec.ts` | INT-001 | Lexical hit produces signal | jobText → direct signal with correct metadata |
| | INT-002 | Hit propagates through adjacency | A→B propagation via adjacency map |
| | INT-003 | Propagated signals participate in ranking | Expanded size ≥ direct size |
| `acceptance-validation.integration.spec.ts` | INT-004 | Threshold enforced | 0.1 rejected, 0.5 accepted |
| | INT-005 | No evidence rejected | Lexical-only with no evidence |
| | INT-006 | Evidence accepted | With evidence → accepted |
| `resume-resolution.integration.spec.ts` | INT-007 | Skills output generated | Full pipeline produces skills section |
| | INT-008 | Experience sorted desc | Score ordering |
| | INT-009 | Projects sorted desc | Score ordering |
| | INT-010 | maxExperience enforced | ≤ policy limit |
| | INT-011 | maxProjects enforced | ≤ policy limit |
| | INT-012 | Trace generated | Each trace has anchorId + score |
| | INT-013 | Resolution strength in trace | Each trace entry has valid strength |
| `artifact-integrity.integration.spec.ts` | INT-014 | Non-existent anchor skipped | Propagation skips anchors not in direct matches |
| | INT-015 | Invalid evidence rejected | AnchorToEvidence → missing evidence → rejected |

### Coverage Summary

| Layer | Files | Cases |
|---|---|---|
| Unit | 12 | 60 |
| Integration | 4 | 15 |
| **Total** | **16** | **75** |

### Coverage Gaps (components without dedicated tests)

| Component | File(s) | Risk |
|---|---|---|
| ProfileParser | `profile-parser.ts` | Low — stable input parsing |
| DraftBuilder | `draft-builder.ts` | Low — standalone feature |
| NormalizationPipeline | `retrieval/normalization.pipeline.ts` | **High** — foundation of all matching |
| RetrievalRanking (utils) | `retrieval/retrieval-ranking.ts` | **High** — used by ranker |
| ExpansionResolver (unit) | `retrieval/expansion-resolver.ts` | **High** — only covered via INT-014 |
| EvidenceResolver | `retrieval/evidence-resolver.ts` | **High** — bridges anchors to evidence |
| RetrievalLogger | `retrieval/logging/retrieval-logger.ts` | Medium — side-effect heavy |
| RetrievalDebugger | `retrieval/retrieval-debugger.ts` | Low — regression test helper |
| SkillClusterResolver | `resume/normalization/skill-cluster-resolver.ts` | Low — simple map lookup |
| AtsSkillGroupMapper | `resume/compiler/ats-skill-group.mapper.ts` | Low — static mapping |
| bootstrapRetrieval | `retrieval/retrieval-engine.ts` | Low — thin factory |
| All 6 ArtifactProducers | `artifacts/producers/*.ts` | Low — build-time only |
| All 3 ArtifactLoaders | `artifacts/loaders/*.ts` | Low — I/O infrastructure |
| MapSerializer | `artifacts/serializers/map.serializer.ts` | Low — simple transforms |
| ArtifactFileUtil | `artifacts/utils/artifact-file.util.ts` | Low — file I/O wrapper |
| AtsSkillGroupCompiler (real) | `resume/compiler/ats-skill-group.compiler.ts` | Medium — only tested via mock |

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
- Root children → fail = root
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
| PropagationEngine.walk | O(direct anchors × adjacency per anchor^maxDepth) | ~50 anchors × ~3 edges × 2 depth |
| EvidenceResolver.resolve | O(expanded anchors × avg evidence per anchor) | ~50 anchors × ~2 evidence |
| RetrievalRanker.rank (per signal) | O(1) feature extraction + O(evidenceIds) | ~5 evidence IDs |
| EvidenceFeaturesExtractor.extract | O(text length × keyword count) | ~500 chars × ~20 keywords |
| ArtifactLoader.load | 5 parallel file reads | ~50KB total |
| RetrievalLogger | O(1) append, capped at 1000 | ≤ 1000 entries |

---

## 18. File Reference

| Area | Directory | Key Files |
|---|---|---|
| Source data | `source/` | `profile.source.ts`, `relations.source.ts`, `templates.source.ts`, `source.types.ts` |
| Core types | `types/` | `retrieval.types.ts` |
| Retrieval pipeline | `retrieval/` | `profile-retrieval-engine.ts`, `aho-corasick.ts`, `normalization.pipeline.ts`, `expansion-resolver.ts`, `evidence-resolver.ts`, `retrieval-engine.ts` |
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
| Generated output | `artifacts/generated/` | `anchors.json`, `evidences.json`, `surfaces.en.json`, `surfaces.vi.json`, `adjacency.json`, `anchor-to-evidence.json`, `metadata.json` |
| Unit tests | `tests/unit/` | 12 spec files |
| Integration tests | `tests/integration/` | 4 spec files |
| Test helpers | `tests/helpers/` | `integration-fixtures.ts` |
| Test setup | `tests/` | `setup.ts`, `tsconfig.json` |
