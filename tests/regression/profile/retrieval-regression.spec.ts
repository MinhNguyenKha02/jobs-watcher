import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll } from 'vitest';

import type { ResolveOutput } from '../../../src/domain/profile/types/resolve.types.js';
import { AssetProducingAdapter } from '../../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { renderPdf } from '../../../src/infrastructure/outbound/asset-builder/renderer/pdf-renderer.js';

import {
  createPipeline,
  runSingle,
  runWithDebug,
  flattenSkills,
  type CorpusEntry,
  PipelineComponents,
} from './helpers/run-pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORPUS_DIR = path.resolve(__dirname, 'corpus');
const EXPECTED_DIR = path.resolve(__dirname, 'expected');
const RECORD = process.env.RECORD === 'true';
const GENERATED_DIR = path.resolve(__dirname, 'generated');

interface ExpectedEntry {
  metadata: { company: string; role: string };
  expectedAnchors: string[];
  expectedSkills: string[];
  expectedProjects: string[];
  expectedResolution: Record<string, string>;
}

function loadCorpusFiles(): { file: string; stem: string; entry: CorpusEntry }[] {
  const files = fs
    .readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const entry = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, file), 'utf-8')) as CorpusEntry;
    const stem = path.basename(file, '.json');
    return { file, stem, entry };
  });
}

function loadExpected(stem: string): ExpectedEntry | null {
  const expectedPath = path.join(EXPECTED_DIR, `${stem}.json`);
  if (!fs.existsSync(expectedPath)) return null;
  return JSON.parse(fs.readFileSync(expectedPath, 'utf-8')) as ExpectedEntry;
}

function recordExpected(stem: string, expected: ExpectedEntry): void {
  const expectedPath = path.join(EXPECTED_DIR, `${stem}.json`);
  fs.mkdirSync(EXPECTED_DIR, { recursive: true });
  fs.writeFileSync(expectedPath, JSON.stringify(expected, null, 2) + '\n', 'utf-8');
}

const profile = {
  name: 'Minh Nguyen Kha',
  email: 'minhnguyen.kha@proton.me',
  phone: '(+84) 39 679 6034',
  location: 'District Binh Thanh, Ho Chi Minh City, Vietnam',
  title: '',
  summary: '',
  skills: [] as string[],
  experience: [],
  education: [
    {
      institution: 'Ho Chi Minh City Open University',
      degree: 'Bachelor of Information Technology',
      field: '',
      startDate: '2021',
      endDate: '2025',
      grade: 'good',
    },
  ],
  links: {
    linkedin: 'https://linkedin.com/in/minh-nguyen-kha',
    github: 'https://github.com/MinhNguyenKha02',
  },
};

const corpusFiles = loadCorpusFiles();
let pipeline: PipelineComponents;

beforeAll(async () => {
  pipeline = await createPipeline();
}, 120000);

if (RECORD) {
  describe('Record Mode — generate expected JSONs', () => {
    corpusFiles.forEach(({ file, stem, entry }) => {
      it(`records expected output for ${stem}`, () => {
        const result = runSingle(pipeline, entry) as ResolveOutput;
        const allSkills = flattenSkills(result);
        const anchorIds = result.traces.map((t) => t.anchorId);
        const projectTitles = result.projects
          .map((p) => p.evidence?.title)
          .filter(Boolean) as string[];

        const resolutionMap: Record<string, string> = {};
        for (const t of result.traces) {
          const lastEntry = t.trace[t.trace.length - 1] as
            { resolutionStrength?: string } | undefined;
          if (lastEntry?.resolutionStrength) {
            resolutionMap[t.anchorId] = lastEntry.resolutionStrength;
          }
        }

        const expected: ExpectedEntry = {
          metadata: { company: entry.company, role: entry.role },
          expectedAnchors: anchorIds,
          expectedSkills: allSkills,
          expectedProjects: projectTitles,
          expectedResolution: resolutionMap,
        };

        recordExpected(stem, expected);
        expect(fs.existsSync(path.join(EXPECTED_DIR, `${stem}.json`))).toBe(true);
      });
    });
  });
} else {
  describe('Retrieval Regression Corpus', () => {
    corpusFiles.forEach(({ file, stem, entry }) => {
      it(`CR-001: ${stem} — pipeline smoke`, () => {
        const result = runSingle(pipeline, entry);
        expect(result).toBeDefined();
        expect(result).toHaveProperty('skills');
        expect(result).toHaveProperty('experiences');
        expect(result).toHaveProperty('projects');
        expect(result).toHaveProperty('traces');
      });

      it(`CR-002: ${stem} — anchor validation`, () => {
        const expected = loadExpected(stem);
        if (!expected) return;
        const result = runSingle(pipeline, entry) as ResolveOutput;
        const anchorIds = result.traces.map((t) => t.anchorId);
        for (const anchor of expected.expectedAnchors) {
          expect(anchorIds).toContain(anchor);
        }
      });

      it(`CR-003: ${stem} — skill validation`, () => {
        const expected = loadExpected(stem);
        if (!expected) return;
        const result = runSingle(pipeline, entry) as ResolveOutput;
        const allSkills = flattenSkills(result);
        for (const skill of expected.expectedSkills) {
          expect(allSkills).toContain(skill);
        }
      });

      it(`CR-004: ${stem} — project validation`, () => {
        const expected = loadExpected(stem);
        if (!expected) return;
        const result = runSingle(pipeline, entry) as ResolveOutput;
        const projectTitles = result.projects.map((p) => p.evidence?.title).filter(Boolean);
        for (const project of expected.expectedProjects) {
          expect(projectTitles).toContain(project);
        }
      });

      it(`CR-005: ${stem} — resolution strength`, () => {
        const expected = loadExpected(stem);
        if (!expected) return;
        const result = runSingle(pipeline, entry) as ResolveOutput;
        for (const [anchorId, expectedStrength] of Object.entries(expected.expectedResolution)) {
          const trace = result.traces.find((t) => t.anchorId === anchorId);
          expect(trace).toBeDefined();
          const lastTraceEntry = trace!.trace[trace!.trace.length - 1] as
            { resolutionStrength?: string } | undefined;
          expect(lastTraceEntry?.resolutionStrength).toBe(expectedStrength);
        }
      });

      it(`CR-006: ${stem} — experience ordering`, () => {
        const result = runSingle(pipeline, entry) as ResolveOutput;
        const scores = result.experiences.map((e) => e.score);
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
        }
        expect(result.experiences.length).toBeLessThanOrEqual(2);
      });

      it(`CR-011: ${stem} — retrieval debug snapshot`, () => {
        const { debug } = runWithDebug(pipeline, entry);
        expect(debug.matchedAnchors.length).toBeGreaterThan(0);
        expect(debug.matchedAnchors[0].matchedPatterns.length).toBeGreaterThan(0);
        expect(debug.matchedAnchors[0]).toHaveProperty('anchorId');
        expect(debug.matchedAnchors[0]).toHaveProperty('score');
        expect(debug.matchedAnchors[0]).toHaveProperty('sources');
        expect(Array.isArray(debug.matchedAnchors[0].trace)).toBe(true);
        expect(debug.matchedAnchors[0].trace[0]).toHaveProperty('type');
        expect(debug.matchedAnchors[0].trace[0]).toHaveProperty('scoreDelta');
        expect(debug.matchedAnchors[0].trace[0]).toHaveProperty('reason');
        if (debug.propagatedAnchors.length > 0) {
          expect(Array.isArray(debug.propagatedAnchors[0].trace)).toBe(true);
        }
        expect(Array.isArray(debug.evidenceScores)).toBe(true);
        if (debug.evidenceScores.length > 0 && debug.evidenceScores[0].evidence) {
          expect(debug.evidenceScores[0].evidence).toHaveProperty('type');
        }
        expect(Array.isArray(debug.resolvedTraces)).toBe(true);
        if (debug.resolvedTraces.length > 0) {
          expect(debug.resolvedTraces[0]).toHaveProperty('resolutionStrength');
          expect(Array.isArray(debug.resolvedTraces[0].trace)).toBe(true);
          expect(debug.resolvedTraces[0].trace[0]).toHaveProperty('resolutionStrength');
        }
        const outputDir = path.join(GENERATED_DIR, stem);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
          path.join(outputDir, 'debug.json'),
          JSON.stringify(debug, null, 2) + '\n',
          'utf-8'
        );
        expect(fs.existsSync(path.join(outputDir, 'debug.json'))).toBe(true);
      });

      it(`CR-012: ${stem} — PDF render`, async () => {
        const result = runSingle(pipeline, entry);
        const adapter = new AssetProducingAdapter();
        const pdfAsset = adapter.toPdf(result, profile);
        const outputDir = path.join(GENERATED_DIR, stem);
        fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = await renderPdf(pdfAsset, outputDir);
        expect(outputPath).toContain('ats.pdf');
        expect(fs.existsSync(outputPath)).toBe(true);
        const header = fs.readFileSync(outputPath).slice(0, 4).toString();
        expect(header).toBe('%PDF');
      });
    });
  });
}
