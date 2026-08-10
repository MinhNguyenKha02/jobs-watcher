import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { indeedDetailHtml } from '../helpers/html-fixtures.js';
import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';

const CASES = {
  'c2-auto': { role: 'Backend Developer', company: 'C2AutoCo' },
  'c2-data': { role: 'Data Engineer', company: 'C2DataCo' },
  'c2-trash': { role: 'Full Stack Developer', company: 'C2TrashCo' },
  'c2-qa': { role: 'Full-stack Developer', company: 'C2QaCo' },
} as const;

const KEY_BY_JOB: Record<string, string> = Object.fromEntries(
  Object.entries(CASES).map(([key, job]) => [`${job.role}|${job.company}`, key])
);

function jobForMessage(messageId: string): { role: string; company: string } {
  if (messageId.includes('trash-msg-2')) return CASES['c2-qa'];
  if (messageId.includes('trash')) return CASES['c2-trash'];
  if (messageId.includes('-2')) return CASES['c2-data'];
  return CASES['c2-auto'];
}

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
        (CASES as Record<string, { role: string; company: string }>)[src] ?? CASES['c2-auto'];
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
          const key = KEY_BY_JOB[`${role}|${company}`] ?? 'c2-auto';
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

  it('Indeed s1(with url) → scheduler+Playwright s2c → [j] queue → QUEUED + real asset pdf → next pick still completes', async () => {
    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED, ActionEvent.PARSE_FAILED]);
    const res = await app.webhook.post('c2-indeed-msg');
    expect(res.status).toBe(202);

    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    const jobId = compMsg.job._id;
    expect(compMsg.job.role).toBe('Backend Developer');
    expect(compMsg.job.company).toBe('C2AutoCo');
    expect(compMsg.job.stage).toBe(JobStage.FULL_PARSED);
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    const queue = await app.events.on([
      ActionEvent.QUEUED,
      ActionEvent.TRASHED,
      ActionEvent.ROUTE_FAILED,
    ]);
    const jRes = await app.uds.action(jobId, 'queue');
    expect(jRes.statusCode).toBe(200);

    const queueMsg = await queue.msg();
    expect(queueMsg.jobLifecycleId).toBe(jobId);

    const pdfPath = await app.artifacts.waitForPdf();
    expect(pdfPath).toBeTruthy();

    const finalDoc = await app.adapter.findById(jobId);
    expect(finalDoc).not.toBeNull();
    expect(finalDoc!.status).toBe(JobStatus.QUEUED);

    const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const res2 = await app.webhook.post('c2-indeed-msg-2');
    expect(res2.status).toBe(202);

    const comp2Msg = await comp2.msg();
    expect(comp2Msg.job).toBeDefined();
    expect(comp2Msg.job._id).not.toBe(jobId);
    expect(comp2Msg.job.role).toBe('Data Engineer');
    expect(comp2Msg.job.company).toBe('C2DataCo');
    expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
  }, 90000);

  it('[d] trash variant: Indeed s1(url) → scheduler+Playwright s2c → [d] trash → TRASHED → next cycle continues', async () => {
    const comp = await app.events.on([ActionEvent.PARSE_COMPLETED, ActionEvent.PARSE_FAILED]);
    const res = await app.webhook.post('c2-indeed-trash-msg');
    expect(res.status).toBe(202);

    const compMsg = await comp.msg();
    expect(compMsg.job).toBeDefined();
    const jobId = compMsg.job._id;
    expect(compMsg.job.role).toBe('Full Stack Developer');
    expect(compMsg.job.company).toBe('C2TrashCo');
    expect(compMsg.job.status).toBe(JobStatus.ENRICHED);

    const trash = await app.events.on([
      ActionEvent.TRASHED,
      ActionEvent.ROUTE_FAILED,
      ActionEvent.PARSE_FAILED,
    ]);
    const dRes = await app.uds.action(jobId, 'trash');
    expect(dRes.statusCode).toBe(200);

    const trashMsg = await trash.msg();
    expect(trashMsg.jobLifecycleId).toBe(jobId);
    expect(trashMsg.reason).toBe('operator:trash');

    const trashed = await app.adapter.findById(jobId);
    expect(trashed).not.toBeNull();
    expect(trashed!.status).toBe(JobStatus.TRASHED);

    const comp2 = await app.events.on([ActionEvent.PARSE_COMPLETED]);
    const res2 = await app.webhook.post('c2-indeed-trash-msg-2');
    expect(res2.status).toBe(202);

    const comp2Msg = await comp2.msg();
    expect(comp2Msg.job).toBeDefined();
    expect(comp2Msg.job._id).not.toBe(jobId);
    expect(comp2Msg.job.role).toBe('Full-stack Developer');
    expect(comp2Msg.job.company).toBe('C2QaCo');
    expect(comp2Msg.job.status).toBe(JobStatus.ENRICHED);
  }, 90000);
});
