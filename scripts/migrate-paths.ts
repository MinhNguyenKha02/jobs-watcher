#!/usr/bin/env node
/**
 * Hexagonal architecture migration script.
 *
 * Usage:
 *   npx tsx scripts/migrate-paths.ts          # execute
 *   npx tsx scripts/migrate-paths.ts --dry-run # preview only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const DRY_RUN = process.argv.includes('--dry-run');

// ── OLD→NEW PATH MAP (relative to src/) ───────────────────────────────────
const MAP: Record<string, string> = {
  // === Domain Types ===
  'types.ts': 'domain/types/job.ts',
  'types/action-snapshot.ts': 'domain/types/action-snapshot.ts',
  'types/canonical.ts': 'domain/types/canonical.ts',
  'types/eventsource.d.ts': 'domain/types/eventsource.d.ts',
  'types/extraction-queue.ts': 'domain/types/extraction-queue.ts',
  'types/job-lifecycle.ts': 'domain/types/job-lifecycle.ts',
  'types/profile-normalized.ts': 'domain/types/profile-normalized.ts',

  // === Domain Services (Parsing) ===
  'services/parsers/html-job-parser.ts': 'domain/services/parsing/html-job-parser.ts',
  'services/job-extraction.ts': 'domain/services/parsing/job-extraction.ts',

  // === Domain Filter ===
  'filter/constraints.ts': 'domain/filter/constraints.ts',
  'filter/job-filter.ts': 'domain/filter/job-filter.ts',

  // === Domain Profile ===
  'services/profile/profile-parser.ts': 'domain/profile/profile-parser.ts',
  'services/profile/profile-retrieval-adapter.ts': 'domain/profile/profile-retrieval-adapter.ts',
  'services/profile/types/retrieval.types.ts': 'domain/profile/types/retrieval.types.ts',
  'services/profile/resume/compiler/ats-skill-group.compiler.ts':
    'domain/profile/resume/compiler/ats-skill-group.compiler.ts',
  'services/profile/resume/compiler/ats-skill-group.mapper.ts':
    'domain/profile/resume/compiler/ats-skill-group.mapper.ts',
  'services/profile/resume/normalization/canonical-skill.map.ts':
    'domain/profile/resume/normalization/canonical-skill.map.ts',
  'services/profile/resume/normalization/skill-cluster-resolver.ts':
    'domain/profile/resume/normalization/skill-cluster-resolver.ts',
  'services/profile/resume/normalization/skill-key-normalizer.ts':
    'domain/profile/resume/normalization/skill-key-normalizer.ts',
  'services/profile/resume/resolve/bullet-selector.ts':
    'domain/profile/resume/resolve/bullet-selector.ts',
  'services/profile/resume/resolve/resume-resolver.ts':
    'domain/profile/resume/resolve/resume-resolver.ts',
  'services/profile/retrieval/aho-corasick.ts': 'domain/profile/retrieval/aho-corasick.ts',
  'services/profile/retrieval/contracts/retrieval.types.ts':
    'domain/profile/retrieval/contracts/retrieval.types.ts',
  'services/profile/retrieval/evidence/evidence-feature-extractor.ts':
    'domain/profile/retrieval/evidence/evidence-feature-extractor.ts',
  'services/profile/retrieval/evidence/evidence-ranker.ts':
    'domain/profile/retrieval/evidence/evidence-ranker.ts',
  'services/profile/retrieval/evidence/evidence-ranking-policy.ts':
    'domain/profile/retrieval/evidence/evidence-ranking-policy.ts',
  'services/profile/retrieval/evidence-resolver.ts':
    'domain/profile/retrieval/evidence-resolver.ts',
  'services/profile/retrieval/expansion-resolver.ts':
    'domain/profile/retrieval/expansion-resolver.ts',
  'services/profile/retrieval/logging/retrieval-logger.ts':
    'domain/profile/retrieval/logging/retrieval-logger.ts',
  'services/profile/retrieval/normalization.pipeline.ts':
    'domain/profile/retrieval/normalization.pipeline.ts',
  'services/profile/retrieval/policies/retrieval.policy.ts':
    'domain/profile/retrieval/policies/retrieval.policy.ts',
  'services/profile/retrieval/profile-retrieval-engine.ts':
    'domain/profile/retrieval/profile-retrieval-engine.ts',
  'services/profile/retrieval/propagation/propagation-engine.ts':
    'domain/profile/retrieval/propagation/propagation-engine.ts',
  'services/profile/retrieval/ranking/ranking-features.ts':
    'domain/profile/retrieval/ranking/ranking-features.ts',
  'services/profile/retrieval/ranking/ranking-policy.ts':
    'domain/profile/retrieval/ranking/ranking-policy.ts',
  'services/profile/retrieval/ranking/retrieval-ranker.ts':
    'domain/profile/retrieval/ranking/retrieval-ranker.ts',
  'services/profile/retrieval/resolution/resolution-strength.ts':
    'domain/profile/retrieval/resolution/resolution-strength.ts',
  'services/profile/retrieval/resolver/retrieval-acceptance.resolver.ts':
    'domain/profile/retrieval/resolver/retrieval-acceptance.resolver.ts',
  'services/profile/retrieval/retrieval-debugger.ts':
    'domain/profile/retrieval/retrieval-debugger.ts',
  'services/profile/retrieval/retrieval-engine.ts': 'domain/profile/retrieval/retrieval-engine.ts',
  'services/profile/retrieval/retrieval-ranking.ts':
    'domain/profile/retrieval/retrieval-ranking.ts',
  'services/profile/retrieval/scoring/match-signal.builder.ts':
    'domain/profile/retrieval/scoring/match-signal.builder.ts',
  'services/profile/retrieval/validation/evidence-attachment.validator.ts':
    'domain/profile/retrieval/validation/evidence-attachment.validator.ts',
  'services/profile/source/profile.source.ts': 'domain/profile/source/profile.source.ts',
  'services/profile/source/profile.source.types.ts':
    'domain/profile/source/profile.source.types.ts',
  'services/profile/source/relations.source.ts': 'domain/profile/source/relations.source.ts',
  'services/profile/source/relations.source.b.ts': 'domain/profile/source/relations.source.b.ts',
  'services/profile/source/relations.source.copy.ts':
    'domain/profile/source/relations.source.copy.ts',
  'services/profile/source/source.types.ts': 'domain/profile/source/source.types.ts',
  'services/profile/source/templates.source.ts': 'domain/profile/source/templates.source.ts',
  'services/profile/artifacts/builders/artifact.builder.ts':
    'domain/profile/artifacts/builders/artifact.builder.ts',
  'services/profile/artifacts/constants/artifact.constants.ts':
    'domain/profile/artifacts/constants/artifact.constants.ts',
  'services/profile/artifacts/loaders/artifact-cache.ts':
    'domain/profile/artifacts/loaders/artifact-cache.ts',
  'services/profile/artifacts/loaders/artifact-hydrator.ts':
    'domain/profile/artifacts/loaders/artifact-hydrator.ts',
  'services/profile/artifacts/loaders/artifact.loader.ts':
    'domain/profile/artifacts/loaders/artifact.loader.ts',
  'services/profile/artifacts/producers/adjacency.producer.ts':
    'domain/profile/artifacts/producers/adjacency.producer.ts',
  'services/profile/artifacts/producers/aho.producer.ts':
    'domain/profile/artifacts/producers/aho.producer.ts',
  'services/profile/artifacts/producers/anchor-evidence.producer.ts':
    'domain/profile/artifacts/producers/anchor-evidence.producer.ts',
  'services/profile/artifacts/producers/anchor.producer.ts':
    'domain/profile/artifacts/producers/anchor.producer.ts',
  'services/profile/artifacts/producers/evidence.producer.ts':
    'domain/profile/artifacts/producers/evidence.producer.ts',
  'services/profile/artifacts/producers/lexical-surface.producer.ts':
    'domain/profile/artifacts/producers/lexical-surface.producer.ts',
  'services/profile/artifacts/serializers/map.serializer.ts':
    'domain/profile/artifacts/serializers/map.serializer.ts',
  'services/profile/artifacts/types/artifact.types.ts':
    'domain/profile/artifacts/types/artifact.types.ts',
  'services/profile/artifacts/utils/artifact-file.util.ts':
    'domain/profile/artifacts/utils/artifact-file.util.ts',
  'services/profile/artifacts/generated/adjacency.json':
    'domain/profile/artifacts/generated/adjacency.json',
  'services/profile/artifacts/generated/anchors.json':
    'domain/profile/artifacts/generated/anchors.json',
  'services/profile/artifacts/generated/anchor-to-evidence.json':
    'domain/profile/artifacts/generated/anchor-to-evidence.json',
  'services/profile/artifacts/generated/evidences.json':
    'domain/profile/artifacts/generated/evidences.json',
  'services/profile/artifacts/generated/metadata.json':
    'domain/profile/artifacts/generated/metadata.json',
  'services/profile/artifacts/generated/surfaces.en.json':
    'domain/profile/artifacts/generated/surfaces.en.json',
  'services/profile/artifacts/generated/surfaces.json':
    'domain/profile/artifacts/generated/surfaces.json',
  'services/profile/artifacts/generated/surfaces.vi.json':
    'domain/profile/artifacts/generated/surfaces.vi.json',

  // === Domain Scoring ===
  'services/scoring/score-matcher.ts': 'domain/scoring/score-matcher.ts',

  // === Application ===
  'bootstrap/execution-mode.ts': 'application/execution-mode.ts',

  // === Infrastructure Outbound ===
  'services/gmail.ts': 'infrastructure/outbound/gmail.ts',
  'services/logger.ts': 'infrastructure/outbound/logging/logger.ts',
  'services/notifications.ts': 'infrastructure/outbound/notifications.ts',
  'services/queue-metrics.ts': 'infrastructure/outbound/monitoring/queue-metrics.ts',
  'services/memory-monitor.ts': 'infrastructure/outbound/monitoring/memory-monitor.ts',
  'services/sse-server.ts': 'infrastructure/outbound/sse-server.ts',
  'services/event-bus.ts': 'infrastructure/event-bus.ts',
  'services/circuit-breaker.ts': 'infrastructure/outbound/circuit-breaker.ts',
  'services/mongodb-validator.ts': 'infrastructure/outbound/persistence/mongodb-validator.ts',
  'services/flatten-job.ts': 'infrastructure/outbound/flatten-job.ts',
  'services/storage/extraction-queue-adapter.ts':
    'infrastructure/outbound/persistence/extraction-queue-adapter.ts',
  'services/storage/mongodb-storage-adapter.ts':
    'infrastructure/outbound/persistence/mongodb-storage-adapter.ts',
  'services/storage/schemas.ts': 'infrastructure/outbound/persistence/schemas.ts',
  'services/sender/delivery-log.ts': 'infrastructure/outbound/sender/delivery-log.ts',
  'services/asset-builder/adapter.ts': 'infrastructure/outbound/asset-builder/adapter.ts',
  'services/asset-builder/asset-builder.ts':
    'infrastructure/outbound/asset-builder/asset-builder.ts',
  'services/asset-builder/cover-letter-renderer.ts':
    'infrastructure/outbound/asset-builder/cover-letter-renderer.ts',
  'services/asset-builder/md-renderer.ts': 'infrastructure/outbound/asset-builder/md-renderer.ts',
  'services/asset-builder/pdf-renderer.ts': 'infrastructure/outbound/asset-builder/pdf-renderer.ts',
  'services/asset-builder/tech-stack.utils.ts':
    'infrastructure/outbound/asset-builder/tech-stack.utils.ts',
  'services/browser/browser-extractor.ts': 'infrastructure/outbound/browser/browser-extractor.ts',
  'db/json.ts': 'infrastructure/outbound/persistence/json.ts',

  // === Infrastructure Inbound ===
  'cli/auth.ts': 'infrastructure/inbound/cli/auth.ts',
  'cli/clipboard-getter.ts': 'infrastructure/inbound/cli/clipboard-getter.ts',
  'cli/dashboard.ts': 'infrastructure/inbound/cli/dashboard.ts',
  'cli/data-listening.ts': 'infrastructure/inbound/cli/data-listening.ts',
  'cli/monitor.ts': 'infrastructure/inbound/cli/monitor.ts',
  'cli/pubsub-subscribe.ts': 'infrastructure/inbound/cli/pubsub-subscribe.ts',
  'cli/pubsub-unsubscribe.ts': 'infrastructure/inbound/cli/pubsub-unsubscribe.ts',
  'cli/setup.ts': 'infrastructure/inbound/cli/setup.ts',
  'services/event-webhook.ts': 'infrastructure/inbound/web/event-webhook.ts',

  // === Infrastructure Utils ===
  'utils/logs-dir.ts': 'infrastructure/utils/logs-dir.ts',
  'utils/p-limit.ts': 'infrastructure/utils/p-limit.ts',
  'utils/uds-http.ts': 'infrastructure/utils/uds-http.ts',

  // === Presentation ===
  'index.ts': 'presentation/bootstrap/main.ts',
  'ui/action-controller.ts': 'presentation/tui/action-controller.ts',
  'ui/ops-tui-app.ts': 'presentation/tui/ops-tui-app.ts',
  'ui/shared-tui-state.ts': 'presentation/tui/shared-tui-state.ts',
  'ui/sse-client.ts': 'presentation/tui/sse-client.ts',
  'ui/components/AnsiStyles.ts': 'presentation/tui/components/AnsiStyles.ts',
  'ui/components/AnsiTerminal.ts': 'presentation/tui/components/AnsiTerminal.ts',
  'ui/components/JobCardRenderer.ts': 'presentation/tui/components/JobCardRenderer.ts',
  'ui/components/KeyboardHandler.ts': 'presentation/tui/components/KeyboardHandler.ts',
  'ui/components/PreviewViewerModal.ts': 'presentation/tui/components/PreviewViewerModal.ts',
  'ui/components/SseJobReader.ts': 'presentation/tui/components/SseJobReader.ts',
  'ui/components/UdsActionWriter.ts': 'presentation/tui/components/UdsActionWriter.ts',

  // === Application (stay in place) ===
  'application/commands.ts': 'application/commands.ts',
  'application/extraction-scheduler.ts': 'application/extraction-scheduler.ts',
  'application/ingestor.ts': 'application/ingestor.ts',
  'application/job-processor.ts': 'application/job-processor.ts',
  'application/ports.ts': 'application/ports.ts',

  // === Config (stay at root) ===
  'config.ts': 'config.ts',
  'constants.ts': 'constants.ts',

  // === CLI (remaining) ===
  'cli/email-source-adapter.ts': 'infrastructure/inbound/cli/email-source-adapter.ts',
  'cli/enhanced-tui.ts': 'infrastructure/inbound/cli/enhanced-tui.ts',
  'cli/feedback-loop.ts': 'infrastructure/inbound/cli/feedback-loop.ts',
  'cli/handlers/DataTestingActionHandler.ts':
    'infrastructure/inbound/cli/handlers/DataTestingActionHandler.ts',
  'cli/manual-enrichment-loop.ts': 'infrastructure/inbound/cli/manual-enrichment-loop.ts',
  'cli/manual-enrichment.ts': 'infrastructure/inbound/cli/manual-enrichment.ts',
  'cli/presenters/DataTestingJobPresenter.ts':
    'infrastructure/inbound/cli/presenters/DataTestingJobPresenter.ts',

  // === DB ===
  'db/database.ts': 'infrastructure/outbound/persistence/database.ts',

  // === Domain constraints ===
  'services/constraints.ts': 'domain/constraints.ts',

  // === Infrastructure Outbound (remaining) ===
  'services/generators/docx-generator.ts': 'infrastructure/outbound/generators/docx-generator.ts',
  'services/generators/generator.ts': 'infrastructure/outbound/generators/generator.ts',
  'services/generators/pdf-generator.ts': 'infrastructure/outbound/generators/pdf-generator.ts',
  'services/generators/smart-generator.ts': 'infrastructure/outbound/generators/smart-generator.ts',
  'services/generators/template-document-generator.ts':
    'infrastructure/outbound/generators/template-document-generator.ts',
  'services/metrics/analytics-queries.ts':
    'infrastructure/outbound/monitoring/analytics-queries.ts',
  'services/metrics/metrics-recorder.ts': 'infrastructure/outbound/monitoring/metrics-recorder.ts',
  'services/sender/email-sender.ts': 'infrastructure/outbound/sender/email-sender.ts',
  'services/storage/enriched-storage.ts': 'infrastructure/outbound/persistence/enriched-storage.ts',
  'services/storage/index.ts': 'infrastructure/outbound/persistence/index.ts',
  'services/storage/job-queue-adapter.ts':
    'infrastructure/outbound/persistence/job-queue-adapter.ts',
  'services/storage/raw-email-storage.ts':
    'infrastructure/outbound/persistence/raw-email-storage.ts',
  'services/templates/index.ts': 'infrastructure/outbound/templates/index.ts',
  'services/templates/renderer.ts': 'infrastructure/outbound/templates/renderer.ts',
  'services/templates/schema.ts': 'infrastructure/outbound/templates/schema.ts',

  // === Domain Services ===
  'services/parsers/email-parser.ts': 'domain/services/parsing/email-parser.ts',
  'services/parsers/parser-ports.ts': 'domain/services/parsing/parser-ports.ts',

  // === Domain Profile (remaining) ===
  'services/profile/draft-builder.ts': 'domain/profile/draft-builder.ts',
  'services/profile/index.ts': 'domain/profile/index.ts',

  // === Infrastructure Inbound (remaining) ===
  'services/tui-input-handler.ts': 'infrastructure/inbound/tui-input-handler.ts',

  // === Presentation TUI (remaining) ===
  'ui/EnrichedJobHandler.ts': 'presentation/tui/EnrichedJobHandler.ts',
  'ui/hooks/useEnrichedJob.ts': 'presentation/tui/hooks/useEnrichedJob.ts',
  'ui/hooks/useJobInput.ts': 'presentation/tui/hooks/useJobInput.ts',
  'ui/hooks/useJobState.ts': 'presentation/tui/hooks/useJobState.ts',
  'ui/services/htmlEnricher.ts': 'presentation/tui/services/htmlEnricher.ts',
  'ui/services/urlHandler.ts': 'presentation/tui/services/urlHandler.ts',
  'ui/theme.ts': 'presentation/tui/theme.ts',
  'ui/TuiJobPresenter.ts': 'presentation/tui/TuiJobPresenter.ts',

  // === Infrastructure Utils (remaining) ===
  'utils/e2e-output-path.ts': 'infrastructure/utils/e2e-output-path.ts',
  'utils/p-index-hard-gates.ts': 'infrastructure/utils/p-index-hard-gates.ts',

  // === Data Fixtures ===
  'db/json.json': 'data/fixtures/json.json',
  'db/e2e-output/e2e-action-log.json': 'data/fixtures/e2e-output/e2e-action-log.json',
  'db/e2e-output/e2e-action-snapshots.json': 'data/fixtures/e2e-output/e2e-action-snapshots.json',
  'db/e2e-output/e2e-job-queue.json': 'data/fixtures/e2e-output/e2e-job-queue.json',
  'db/e2e-output/e2e-job-trash.json': 'data/fixtures/e2e-output/e2e-job-trash.json',
  'db/e2e-output/e2e-metrics.json': 'data/fixtures/e2e-output/e2e-metrics.json',
  'db/e2e-output/e2e-needs-enrichment.json': 'data/fixtures/e2e-output/e2e-needs-enrichment.json',
  'db/e2e-output/e2e-parse-log.json': 'data/fixtures/e2e-output/e2e-parse-log.json',
  'db/e2e-output/e2e-raw-ingest.json': 'data/fixtures/e2e-output/e2e-raw-ingest.json',
  'db/e2e-output/e2e-summary.json': 'data/fixtures/e2e-output/e2e-summary.json',
  'db/emails/2026-01/28/filtered-jobs.json': 'data/fixtures/emails/2026-01/28/filtered-jobs.json',
};

// Add enriched email fixtures
const ENRICHED_EMAIL_DIRS = [
  'customer-service-staff-hcm763--chi-nh-nh-c-ng-ty-cp-k-t-n-t-n-0-406875',
  'fresher-developer-ti-ng-nh-t-t-c-ng-ty-c-ph-n-ph-n-m-m-luvina-2-892021',
  'fresher-embedded-engineer-marusys-vina-co-ltd-4-685995',
  'front-end-developer-teqnological-asia-co-ltd-3-725354',
  'frontend-software-engineer-mid-floating-cube-studios-0-105758',
  '-hybrid-fresher-junior-sofware-c-ng-ty-tnhh-gmo-z-com-vi-t-na-3-818506',
  'middle-frontend-developer-reac-c-ng-ty-c-ph-n-citics-1-434909',
  'mid-senior-frontend-developer--hitachi-digital-services-0-305567',
  'quality-analyst-qa-night-shift-c-ng-ty-tnhh-gear-inc-vn-0-786903',
  '-senior-frontend-developer-rea-zalo-0-352152',
  'senior-frontend-developer-zalo-0-326802',
  'senior-frontend-developer-zalo-0-373644',
  'tester-game-ch-tuy-n-n-ph-ng-v-c-ng-ty-tnhh-c-ng-ngh-hay-hay--0-859575',
];
for (const dir of ENRICHED_EMAIL_DIRS) {
  MAP[`db/emails/enriched/2026-02/05/${dir}/enriched-record.json`] =
    `data/fixtures/emails/enriched/2026-02/05/${dir}/enriched-record.json`;
  MAP[`db/emails/enriched/2026-02/05/${dir}/metadata.json`] =
    `data/fixtures/emails/enriched/2026-02/05/${dir}/metadata.json`;
}

// ── Resolve import to a filesystem path ──────────────────────────────────

/**
 * Given an import like './foo.js' or '../../bar/baz.js' and the old source file
 * location (relative to src/), resolve it to an absolute filesystem path,
 * then return the path relative to src/.
 */
function resolveImport(oldRelFile: string, importPath: string): string | null {
  const oldDir = path.dirname(path.join(SRC, oldRelFile));
  const resolved = path.resolve(oldDir, importPath);

  if (!resolved.startsWith(SRC + path.sep) && resolved !== SRC) return null;

  const rel = path.relative(SRC, resolved);

  // NodeNext convention: import './foo.js' resolves to ./foo.ts on disk.
  // Strip .js and try likely extensions.
  const noJs = rel.replace(/\.js$/, '');
  const candidates = [
    noJs + '.ts', // ./foo.js → ./foo.ts
    noJs + '.d.ts', // ./foo.js → ./foo.d.ts
    rel, // as-is (bare relative)
    rel + '.ts', // ./foo → ./foo.ts
    noJs + '/index.ts', // ./dir.js → ./dir/index.ts
    noJs + '/index.d.ts', // ./dir.js → ./dir/index.d.ts
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(SRC, c))) {
      if (c.endsWith('.d.ts')) return c;
      return c.endsWith('.ts') ? c : c + '.ts';
    }
  }
  // Not found on disk — check if the resolved path is a MAP key
  // (file may have already been moved by the time this import is processed)
  for (const c of candidates) {
    if (MAP[c]) return c; // return old key; caller uses MAP to find new location
  }
  return null;
}

/**
 * Compute a relative import path from `fromFile` (relative to src/)
 * to `toRelTarget` (relative to src/).
 * Ensures .js extension (nodenext convention).
 */
function computeRelative(fromFileRel: string, toTargetRel: string): string {
  const fromDir = path.dirname(path.join(SRC, fromFileRel));
  const toAbs = path.join(SRC, toTargetRel);
  let rel = path.relative(fromDir, toAbs);
  if (!rel.startsWith('.')) rel = './' + rel;
  // Ensure .js extension (nodenext), except .d.ts
  if (!rel.endsWith('.d.ts')) {
    rel = rel.replace(/\.ts$/, '.js');
  }
  return rel;
}

// ── Rewrite imports in a file content ────────────────────────────────────

interface ImportMatch {
  start: number;
  end: number;
  full: string;
  keyword: string;
  importPath: string;
  quote: string;
}

function findAllImports(content: string): ImportMatch[] {
  const results: ImportMatch[] = [];
  // Matches: from '...'   from "..."   require('...')   import('...')
  const re = /(from\s+|require\s*\(|import\s*\()\s*['"]([^'"]+?)['"]\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    results.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      keyword: m[1].trim(),
      importPath: m[2],
      quote: m[0].includes('"') ? '"' : "'",
    });
  }
  return results;
}

// ── Process a single file ────────────────────────────────────────────────

function processFile(oldRel: string, newRel: string, write: boolean): boolean {
  const oldAbs = path.join(SRC, oldRel);
  const newAbs = path.join(SRC, newRel);
  let content = fs.readFileSync(oldAbs, 'utf-8');

  const imports = findAllImports(content);
  let modified = false;
  let result = content;

  // Process from right to left to preserve indices
  for (let i = imports.length - 1; i >= 0; i--) {
    const imp = imports[i];
    if (!imp.importPath.startsWith('.') && !imp.importPath.startsWith('..')) {
      continue; // bare specifier, skip
    }

    const resolvedRel = resolveImport(oldRel, imp.importPath);
    if (!resolvedRel) continue; // can't resolve, leave as-is

    // Determine target path: if resolved file is also in MAP, use its new location
    const targetRel = MAP[resolvedRel] || resolvedRel;

    // Compute new relative import from the NEW file location
    const newImportPath = computeRelative(newRel, targetRel);

    if (newImportPath !== imp.importPath) {
      const before = result.slice(0, imp.start);
      const after = result.slice(imp.end);
      const replacement = imp.full.replace(imp.importPath, newImportPath);
      result = before + replacement + after;
      modified = true;
    }
  }

  if (write) {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
    fs.writeFileSync(newAbs, result, 'utf-8');
    if (oldAbs !== newAbs) {
      fs.unlinkSync(oldAbs);
    }
    console.log(`  ✓ ${oldRel} → ${newRel}` + (modified ? ' (imports)' : ''));
  } else {
    console.log(`  ~ ${oldRel} → ${newRel}` + (modified ? ' (imports)' : '') + ' (dry-run)');
  }
  return modified;
}

// ── Walk all .ts files in src/ ───────────────────────────────────────────

function walkSrcFiles(): string[] {
  const result: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts') || entry.name.endsWith('.json'))
      ) {
        result.push(path.relative(SRC, full));
      }
    }
  }
  walk(SRC);
  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────

function main() {
  console.log(DRY_RUN ? '══ DRY RUN ══' : '══ EXECUTING ══');
  console.log('');

  const allFiles = walkSrcFiles();
  const tsFiles = allFiles.filter((f) => f.endsWith('.ts') || f.endsWith('.d.ts'));
  const jsonFiles = allFiles.filter((f) => !f.endsWith('.ts') && !f.endsWith('.d.ts'));

  // Step 1: Process all .ts files — move tracked ones + fix imports in ALL of them
  console.log(`  Rewriting imports in ${tsFiles.length} .ts files...`);
  console.log('');

  // Sort so deeper paths come first (avoids parent-dir removal before children)
  const tsSorted = [...tsFiles].sort((a, b) => b.split('/').length - a.split('/').length);

  let moved = 0;
  let updated = 0;

  for (const oldRel of tsSorted) {
    const newRel = MAP[oldRel] || oldRel; // stays in place if not in MAP
    const modified = processFile(oldRel, newRel, !DRY_RUN);
    if (newRel !== oldRel) moved++;
    if (modified) updated++;
  }

  // Step 2: Move JSON/data files that are in MAP
  console.log('');
  for (const oldRel of jsonFiles) {
    const newRel = MAP[oldRel];
    if (!newRel) continue; // not in MAP, stays
    const oldAbs = path.join(SRC, oldRel);
    const newAbs = path.join(SRC, newRel);
    if (DRY_RUN) {
      console.log(`  ~ ${oldRel} → ${newRel} (json, dry-run)`);
    } else {
      fs.mkdirSync(path.dirname(newAbs), { recursive: true });
      fs.copyFileSync(oldAbs, newAbs);
      fs.unlinkSync(oldAbs);
      console.log(`  ✓ ${oldRel} → ${newRel} (json)`);
    }
  }

  console.log('');
  console.log(`  Results: ${moved} files moved, ${updated} files had import changes`);
  if (DRY_RUN) {
    console.log('══ Dry run complete. Run without --dry-run to execute. ══');
  } else {
    console.log('══ Migration complete. ══');
  }
}

main();
