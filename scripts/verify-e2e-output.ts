import fs from 'fs';
import path from 'path';

import { getE2EOutputDir, getE2EOutputDirRelativeToRoot } from '../src/utils/e2e-output-path.js';
import {
  type GateRecord,
  type HardGateFailure,
  type HardGateInput,
  validateP0HardGate,
  validateP1P2HardGate,
} from '../src/utils/p-index-hard-gates.js';

type ValidationFailure = {
  file: string;
  reason: string;
};

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function ensureArray(value: unknown, file: string, failures: ValidationFailure[]) {
  if (!Array.isArray(value)) {
    failures.push({ file, reason: 'Expected JSON array' });
  }
}

function ensureObject(value: unknown, file: string, failures: ValidationFailure[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    failures.push({ file, reason: 'Expected JSON object' });
  }
}

function main() {
  const outputDir = getE2EOutputDir();
  const relativeOutputDir = getE2EOutputDirRelativeToRoot();

  const requiredArrayFiles = [
    'e2e-raw-ingest.json',
    'e2e-parse-log.json',
    'e2e-needs-enrichment.json',
    'e2e-job-queue.json',
    'e2e-job-trash.json',
    'e2e-action-log.json',
    'e2e-metrics.json',
  ];
  const requiredObjectFiles = ['e2e-summary.json'];

  if (!fs.existsSync(outputDir)) {
    console.error(`[verify:e2e-output] Missing output directory: ${relativeOutputDir}`);
    process.exit(1);
  }

  const failures: ValidationFailure[] = [];

  for (const file of requiredArrayFiles) {
    const filePath = path.join(outputDir, file);
    if (!fs.existsSync(filePath)) {
      failures.push({ file, reason: 'Missing required file' });
      continue;
    }
    try {
      const parsed = readJson(filePath);
      ensureArray(parsed, file, failures);
    } catch (error) {
      failures.push({
        file,
        reason: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  for (const file of requiredObjectFiles) {
    const filePath = path.join(outputDir, file);
    if (!fs.existsSync(filePath)) {
      failures.push({ file, reason: 'Missing required file' });
      continue;
    }
    try {
      const parsed = readJson(filePath);
      ensureObject(parsed, file, failures);
    } catch (error) {
      failures.push({
        file,
        reason: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (failures.length > 0) {
    console.error(`[verify:e2e-output] Validation failed for ${relativeOutputDir}`);
    failures.forEach((failure) => {
      console.error(`  - ${failure.file}: ${failure.reason}`);
    });
    process.exit(1);
  }

  const raw = readJson(path.join(outputDir, 'e2e-raw-ingest.json')) as unknown[];
  const queue = readJson(path.join(outputDir, 'e2e-job-queue.json')) as unknown[];
  const trash = readJson(path.join(outputDir, 'e2e-job-trash.json')) as unknown[];
  const needs = readJson(path.join(outputDir, 'e2e-needs-enrichment.json')) as unknown[];
  const parseLog = readJson(path.join(outputDir, 'e2e-parse-log.json')) as unknown[];
  const actionLog = readJson(path.join(outputDir, 'e2e-action-log.json')) as unknown[];
  const metrics = readJson(path.join(outputDir, 'e2e-metrics.json')) as unknown[];

  const downstream = queue.length + trash.length + needs.length;
  if (raw.length > 0 && downstream === 0) {
    console.error(
      `[verify:e2e-output] Potential data-loss risk: raw_ingest=${raw.length} but downstream records=0`
    );
    process.exit(1);
  }

  if (raw.length > 0 && parseLog.length === 0) {
    console.error(
      `[verify:e2e-output] Potential processing gap: raw_ingest=${raw.length} but parse_log=0`
    );
    process.exit(1);
  }

  const hardGateInput: HardGateInput = {
    actionLog: actionLog as GateRecord[],
    needsEnrichment: needs as GateRecord[],
    jobQueue: queue as GateRecord[],
    jobTrash: trash as GateRecord[],
    metrics: metrics as GateRecord[],
  };

  const hardFailures: HardGateFailure[] = [];
  if (process.env.VERIFY_P0_HARD === '1') {
    hardFailures.push(...validateP0HardGate(hardGateInput));
  }
  if (process.env.VERIFY_P1P2_HARD === '1') {
    hardFailures.push(...validateP1P2HardGate(hardGateInput));
  }

  if (hardFailures.length > 0) {
    console.error(`[verify:e2e-output] Hard gate failed for ${relativeOutputDir}`);
    hardFailures.forEach((failure) => {
      console.error(`  - ${failure.gate}: ${failure.reason}`);
    });
    process.exit(1);
  }

  console.log(
    `[verify:e2e-output] OK ${relativeOutputDir} raw=${raw.length} parse_log=${parseLog.length} queue=${queue.length} trash=${trash.length} needs_enrichment=${needs.length}`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}