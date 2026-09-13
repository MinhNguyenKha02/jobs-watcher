import http from 'http';
import fs, { readdirSync } from 'node:fs';
import path from 'node:path';

import amqplib from 'amqplib';

import {
  buildPdfFilename,
  sanitizeSnake,
} from '../../src/infrastructure/outbound/asset-builder/renderer/pdf-renderer.js';
import { postJsonOverUds } from '../../src/infrastructure/utils/uds-http.js';

export const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

/** Poll a boolean predicate until true, throwing after the timeout. */
export async function waitFor(
  check: () => boolean,
  timeoutMs = 15000,
  intervalMs = 50
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * @deprecated Do not use in new suites — prefer `tui.reader.purgeQueues()`.
 * Kept for backward compat. Purge-only (never assertQueue): asserting would
 * CREATE a missing queue (incl. the retired `consume.*` family) as a side effect.
 */
export async function purgeTuiQueues(ns: string): Promise<void> {
  const conn = await amqplib.connect(RMQ_URL);
  const ch = await conn.createChannel();
  const queues = [
    `tui.${ns}.s1`,
    `tui.${ns}.s2`,
    `tui.${ns}.s3s4`,
    `tui.${ns}.consume.s1`,
    `tui.${ns}.consume.s2`,
    `tui.${ns}.consume.s34`,
  ];
  for (const q of queues) {
    try {
      await ch.purgeQueue(q);
    } catch {
      /* best-effort — a missing queue (404) is treated as empty */
    }
  }
  try {
    await ch.close();
  } catch {
    /* channel may already be closed by the server */
  }
  await conn.close();
}

const TEST_EXCHANGE_PREFIX = 'jobs.events.int.';

/**
 * Test-only exchange teardown for daemon-only suites (no TUI reader exists
 * there to own queue/exchange lifecycle). Deletes exactly one exchange and
 * only under the `jobs.events.int.` test prefix — anything else (incl. prod
 * `jobs.events`) is refused silently. Best-effort, never throws.
 */
export async function deleteTestExchange(exchange: string): Promise<void> {
  if (!exchange.startsWith(TEST_EXCHANGE_PREFIX)) return;
  try {
    const conn = await amqplib.connect(RMQ_URL);
    const ch = await conn.createChannel();
    try {
      await ch.deleteExchange(exchange);
    } catch {
      /* best-effort — already gone (404) is treated as deleted */
    }
    try {
      await ch.close();
    } catch {
      /* channel may already be closed by the server */
    }
    await conn.close().catch(() => {});
  } catch {
    /* broker unreachable — teardown must not fail the suite */
  }
}

function countPdfsRecursive(dir: string): number {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.pdf')) count++;
      else if (e.isDirectory()) count += countPdfsRecursive(path.join(dir, e.name));
    }
  } catch {
    /* dir may not exist yet */
  }
  return count;
}

/** Poll an asset output dir until it contains at least one PDF (recursive). */
export function waitForPdfFiles(dir: string, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (countPdfsRecursive(dir) > 0) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error(`Timeout waiting for pdf asset in ${dir}`));
      setTimeout(poll, 250);
    };
    poll();
  });
}

/** Poll until at least expectedCount PDFs exist (recursive). */
export function waitForPdfCount(
  dir: string,
  expectedCount: number,
  timeoutMs = 30000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (countPdfsRecursive(dir) >= expectedCount) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error(`Timeout waiting for ${expectedCount} pdfs in ${dir}`));
      setTimeout(poll, 250);
    };
    poll();
  });
}

/** Build expected filename for a queued job (mirrors src sanitization). */
export function expectedPdfFilename(meta: {
  jobId: string;
  role?: string;
  company?: string;
  location?: string;
}): string {
  return buildPdfFilename(meta);
}

/** Poll until the pdf for a specific job exists (per-job subdir assets/<jobId>/). */
export function waitForPdfForJob(
  dir: string,
  meta: { jobId: string; role?: string; company?: string; location?: string },
  timeoutMs = 25000
): Promise<void> {
  const expected = expectedPdfFilename(meta);
  const perJobDir = meta.jobId ? path.join(dir, sanitizeSnake(meta.jobId)) : dir;
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      try {
        const p = path.join(perJobDir, expected);
        if (fs.existsSync(p)) return resolve();
        // fallback flat for backward compat (ats.pdf)
        if (fs.existsSync(path.join(dir, expected))) return resolve();
      } catch {
        /* ignore */
      }
      if (Date.now() - start > timeoutMs)
        return reject(
          new Error(`Timeout waiting for pdf ${expected} in ${dir}/${sanitizeSnake(meta.jobId)}`)
        );
      setTimeout(poll, 250);
    };
    poll();
  });
}

/** Best-effort purge of asset dir (for per-job isolation, recursive). */
export function purgeAssetDir(dir: string): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else if (e.name.endsWith('.pdf') || e.name.endsWith('.html') || e.name.endsWith('.css')) {
          fs.unlinkSync(p);
        }
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* dir may not exist */
  }
}

/**
 * UDS client bound to a shared internal token. Timeout parity with the
 * facade action-writer (60s): real-mode [j] resolution renders the PDF before
 * responding. `ingest(html, jobLifecycleId)` uses the webhook flag.
 */
export function udsHelpers(socketPath: string, token: string) {
  const post = (pathName: string, body: unknown) =>
    postJsonOverUds(
      {
        socketPath,
        path: pathName,
        headers: { 'x-internal-token': token },
        timeoutMs: 60000,
      },
      body
    );
  return {
    ingest: (html: string, jobLifecycleId?: string) =>
      post(`/internal/ingest${jobLifecycleId ? '?webhook=true' : ''}`, { html, jobLifecycleId }),
    action: (jobLifecycleId: string, action: string) =>
      post('/internal/action', { jobLifecycleId, action }),
  };
}

export function postJson(
  port: number,
  pathName: string,
  body: unknown
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathName,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
