/*
 * e2e c2-browser-auto (P3 skeleton: 2 real containers, black-box, final-outcome asserts):
 *   S1 Indeed webhook(url) → scheduler + Playwright s2c → [j] QUEUED + PDF / [d] TRASHED.
 *   Assert ONLY final outcomes: daemon.mongo S3/S4 status + real asset PDF + the ipc seam
 *   folded into the needy checkpoints + the next pick still completing. Each message maps
 *   to a distinct role/company (dedupe-safe) so the long-running scheduler never conflicts.
 */
import http from 'node:http';

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { createE2eApp, type E2eApp } from '../helpers/e2e-app.js';
import { indeedDetailHtml } from '../helpers/html-fixtures.js';

const CASES = {
  c2Auto: { role: 'Backend Developer', company: 'C2AutoCo' },
  c2Data: { role: 'Data Engineer', company: 'C2DataCo' },
  c2Trash: { role: 'Full Stack Developer', company: 'C2TrashCo' },
  c2Qa: { role: 'Full-stack Developer', company: 'C2QaCo' },
  c2Ring: { role: 'Software Engineer', company: 'C2RingCo' },
  c2RingNext: { role: 'Automation Engineer', company: 'C2RingNextCo' },
} as const;

const KEY_BY_JOB: Record<string, string> = Object.fromEntries(
  Object.entries(CASES).map(([key, job]) => [`${job.role}|${job.company}`, key])
);

function jobForMessage(messageId: string): { role: string; company: string } {
  if (messageId.includes('trash-msg-2')) return CASES['c2Qa'];
  if (messageId.includes('trash')) return CASES['c2Trash'];
  if (messageId.includes('-2')) return CASES['c2Data'];
  if (messageId.includes('ring-next')) return CASES['c2RingNext'];
  if (messageId.includes('ring')) return CASES['c2Ring'];
  return CASES['c2Auto'];
}

const waitForStatus = (app: E2eApp, jobId: string, status: JobStatus) =>
  vi.waitUntil(async () => (await app.jobLifecycle.findById(jobId))?.status === status, {
    timeout: 30000,
  });

/**
 * URL must satisfy the ingestor's S1 enqueue heuristic (`indeed.com/viewjob?`)
 * while pointing at a local server the Scheduler/Playwright can actually fetch.
 * The query carries a single `src` token (no `&`, so cheerio keeps the href
 * intact) which the server maps back to role/company.
 */
function startDetailServer(): Promise<{
  srcUrl: (role: string, company: string) => string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const src = parsed.searchParams.get('src') || '';
      const job =
        (CASES as Record<string, { role: string; company: string }>)[src] ?? CASES['c2Auto'];
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        indeedDetailHtml(
          job.role,
          job.company,
          `http://127.0.0.1:${(server.address() as any).port}/indeed.com/viewjob?src=${src}`
        )
      );
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as any;
      resolve({
        srcUrl: (role, company) => {
          const key = KEY_BY_JOB[`${role}|${company}`] ?? 'c2Auto';
          return `http://127.0.0.1:${addr.port}/indeed.com/viewjob?src=${key}`;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('C2 browser-auto e2e — webhook Indeed s1(url) → scheduler + Playwright s2c → [j] queue + PDF / [d] trash (prod bootstrap)', () => {
  let app: E2eApp;
  let detail: Awaited<ReturnType<typeof startDetailServer>>;

  beforeAll(async () => {
    detail = await startDetailServer();
    app = await createE2eApp({
      ns: 'c2-browser-auto',
      startScheduler: true,
      indeedUrl: (role, company) => detail.srcUrl(role, company),
      jobForMessage,
    });
  }, 120000);

  afterAll(async () => {
    try {
      await detail.close();
    } catch {
      /* best-effort */
    }
    await app.stop();
  });

  describe('(a) S1 webhook(url) → scheduler+Playwright s2c → [j] QUEUED + PDF, next pick', () => {
    it('GIVEN Indeed s1(with url) WHEN scheduler+Playwright s2c → [j] queue THEN QUEUED + real asset pdf and the tui mirror clears · e2e c2', async () => {
      const jobId = 'c2-indeed-msg-job-0';

      const res = await app.webhook.post('c2-indeed-msg');
      expect(res.status).toBe(202);
      await waitForStatus(app, jobId, JobStatus.ENRICHED);
      expect((await app.jobLifecycle.findById(jobId))!.role).toBe('Backend Developer');

      const jRes = await app.uds.action(jobId, 'queue');
      expect(jRes.statusCode).toBe(200);

      await waitForStatus(app, jobId, JobStatus.QUEUED);
      const pdfPath = await app.artifacts.waitForPdf();
      expect(pdfPath).toBeTruthy();
      await vi.waitUntil(() => app.tui.ipc.read().jobLifecycleId === null, { timeout: 15000 });

      const nextId = 'c2-indeed-msg-2-job-0';
      const res2 = await app.webhook.post('c2-indeed-msg-2');
      expect(res2.status).toBe(202);
      await waitForStatus(app, nextId, JobStatus.ENRICHED);
      const nextDoc = await app.jobLifecycle.findById(nextId);
      expect(nextDoc!.role).toBe('Data Engineer');
      expect(nextDoc!._id).not.toBe(jobId);
    }, 120000);
  });

  describe('(b) S1 webhook(url) → scheduler+Playwright s2c → [d] TRASHED, next cycle', () => {
    it('GIVEN [d] trash variant: Indeed s1(url) WHEN scheduler+Playwright s2c → [d] trash THEN TRASHED and the next cycle still completes · e2e c2', async () => {
      const jobId = 'c2-indeed-trash-msg-job-0';

      const res = await app.webhook.post('c2-indeed-trash-msg');
      expect(res.status).toBe(202);
      await waitForStatus(app, jobId, JobStatus.ENRICHED);
      expect((await app.jobLifecycle.findById(jobId))!.role).toBe('Full Stack Developer');

      const dRes = await app.uds.action(jobId, 'trash');
      expect(dRes.statusCode).toBe(200);

      await waitForStatus(app, jobId, JobStatus.TRASHED);

      const nextId = 'c2-indeed-trash-msg-2-job-0';
      const res2 = await app.webhook.post('c2-indeed-trash-msg-2');
      expect(res2.status).toBe(202);
      await waitForStatus(app, nextId, JobStatus.ENRICHED);
      const nextDoc = await app.jobLifecycle.findById(nextId);
      expect(nextDoc!.role).toBe('Full-stack Developer');
      expect(nextDoc!._id).not.toBe(jobId);
    }, 120000);
  });

  describe('(c) ring closure — full [j] cycle + ipc seam + next pick', () => {
    it('GIVEN a completed auto cycle WHEN a fresh Indeed s1(url) follows THEN the next job reaches ENRICHED through the scheduler and the ipc seam stays empty · e2e c2', async () => {
      await app.resetDb();
      app.tui.rmq.reader.resetReader();
      const jobId = 'c2-indeed-ring-msg-job-0';

      const res = await app.webhook.post('c2-indeed-ring-msg');
      expect(res.status).toBe(202);
      await waitForStatus(app, jobId, JobStatus.ENRICHED);

      const jRes = await app.uds.action(jobId, 'queue');
      expect(jRes.statusCode).toBe(200);
      await waitForStatus(app, jobId, JobStatus.QUEUED);
      await vi.waitUntil(() => app.tui.ipc.read().jobLifecycleId === null, { timeout: 15000 });

      const nextId = 'c2-indeed-ring-next-msg-job-0';
      const res2 = await app.webhook.post('c2-indeed-ring-next-msg');
      expect(res2.status).toBe(202);
      await waitForStatus(app, nextId, JobStatus.ENRICHED);
      expect((await app.jobLifecycle.findById(nextId))!._id).not.toBe(jobId);
    }, 120000);
  });
});
