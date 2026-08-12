/*
 * e2e c2-browser-auto (prod bootstrap, real deps, black-box; no IoC in the body):
 * GIVEN an Indeed webhook msg with URL WHEN scheduler+Playwright S2c runs + [j]/[d] UDS action
 * THEN S3 QUEUED + real PDF, or S4 TRASHED, and the next pick still completes.
 */
import http from 'node:http';

import amqplib from 'amqplib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { JobStage, JobStatus } from '../../src/domain/types/job-lifecycle.js';
import { getCurrentJob } from '../../src/presentation/tui/shared-tui-state.js';
import { createE2eApp, ActionEvent, type E2eApp } from '../helpers/e2e-app.js';
import { indeedDetailHtml, topcvDetailHtml } from '../helpers/html-fixtures.js';
import { buildTuiTestContainer } from '../helpers/test-container.js';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function waitFor(check: () => boolean, timeoutMs = 15000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

async function purgeTuiQueues(ns: string): Promise<void> {
  const conn = await amqplib.connect(RMQ_URL);
  const ch = await conn.createChannel();
  for (const suffix of ['s1', 's2', 's3s4']) {
    try {
      await ch.assertQueue(`tui.${ns}.${suffix}`);
      await ch.purgeQueue(`tui.${ns}.${suffix}`);
    } catch {
      /* best-effort — a missing/closed queue is treated as empty */
    }
  }
  try {
    await ch.close();
  } catch {
    /* channel may already be closed by the server */
  }
  await conn.close();
}

const CASES = {
  c2Auto: { role: 'Backend Developer', company: 'C2AutoCo' },
  c2Data: { role: 'Data Engineer', company: 'C2DataCo' },
  c2Trash: { role: 'Full Stack Developer', company: 'C2TrashCo' },
  c2Qa: { role: 'Full-stack Developer', company: 'C2QaCo' },
} as const;

const KEY_BY_JOB: Record<string, string> = Object.fromEntries(
  Object.entries(CASES).map(([key, job]) => [`${job.role}|${job.company}`, key])
);

function jobForMessage(messageId: string): { role: string; company: string } {
  if (messageId.includes('trash-msg-2')) return CASES['c2Qa'];
  if (messageId.includes('trash')) return CASES['c2Trash'];
  if (messageId.includes('-2')) return CASES['c2Data'];
  return CASES['c2Auto'];
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

  it('GIVEN Indeed s1(with url) WHEN scheduler+Playwright s2c → [j] queue → QUEUED + real asset pdf THEN next pick still completes', async () => {
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

  it('GIVEN [d] trash variant: Indeed s1(url) WHEN scheduler+Playwright s2c → [d] trash → TRASHED THEN next cycle continues', async () => {
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

  it('GIVEN the tui-ioc precondition WHEN the daemon webhook+paste publishes S1+S2 over RMQ and the tui sends [j] over UDS THEN the reader mirrors then clears the job on the ipc seam (tui↔daemon real RMQ+UDS) · e2e c2', async () => {
    await purgeTuiQueues('c2-browser-auto');
    const tui = await buildTuiTestContainer({ ns: 'c2-browser-auto' });
    try {
      await waitFor(() => tui.rmqReader.isConnected());
      await app.resetDb();

      const gen = await app.events.on([ActionEvent.GENERATED]);
      const res = await app.webhook.post('c2-boundary-msg');
      expect(res.status).toBe(202);

      const genMsg = await gen.msg();
      const jobId: string = genMsg._id;
      expect(genMsg.company).toBe('C2AutoCo');
      await waitFor(() => getCurrentJob().jobLifecycleId === jobId);
      expect(getCurrentJob().stage).toBe(JobStage.PARTIAL_PARSED);

      const comp = await app.events.on([ActionEvent.PARSE_COMPLETED]);
      const cRes = await app.uds.ingest(topcvDetailHtml('Backend Developer', 'C2AutoCo'), jobId);
      expect(cRes.statusCode).toBe(200);

      const compMsg = await comp.msg();
      expect(compMsg.job._id).toBe(jobId);
      await waitFor(
        () =>
          getCurrentJob().jobLifecycleId === jobId && getCurrentJob().stage === JobStage.FULL_PARSED
      );

      const queue = await app.events.on([
        ActionEvent.QUEUED,
        ActionEvent.TRASHED,
        ActionEvent.ROUTE_FAILED,
      ]);
      await tui.udsWriter.queue(jobId);

      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobId);
      await waitFor(() => getCurrentJob().jobLifecycleId === null);
      expect(getCurrentJob().job).toBeNull();
    } finally {
      await tui.stop();
    }
  }, 90000);
});
