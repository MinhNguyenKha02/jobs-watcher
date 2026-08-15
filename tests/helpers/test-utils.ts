import http from 'http';
import { readdirSync } from 'node:fs';

import amqplib from 'amqplib';

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

/** Best-effort purge of the TUI per-namespace RMQ queues (reader s1/s2/s3s4 + facade consume s1/s2/s34). */
export async function purgeTuiQueues(ns: string): Promise<void> {
  const conn = await amqplib.connect(RMQ_URL);
  const ch = await conn.createChannel();
  const readerSuffixes = ['s1', 's2', 's3s4'];
  const consumeSuffixes = ['consume.s1', 'consume.s2', 'consume.s34'];
  for (const suffix of readerSuffixes) {
    try {
      await ch.assertQueue(`tui.${ns}.${suffix}`);
      await ch.purgeQueue(`tui.${ns}.${suffix}`);
    } catch {
      /* best-effort — a missing/closed queue is treated as empty */
    }
  }
  for (const suffix of consumeSuffixes) {
    try {
      await ch.assertQueue(`tui.${ns}.${suffix}`, { durable: false });
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

/** Poll an asset output dir until it contains at least one PDF. */
export function waitForPdfFiles(dir: string, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith('.pdf'));
        if (files.length > 0) return resolve();
      } catch {
        /* dir may not be created yet */
      }
      if (Date.now() - start > timeoutMs)
        return reject(new Error(`Timeout waiting for pdf asset in ${dir}`));
      setTimeout(poll, 250);
    };
    poll();
  });
}

/** UDS client bound to a shared internal token. `ingest(html, jobLifecycleId)` uses the webhook flag. */
export function udsHelpers(socketPath: string, token: string) {
  return {
    ingest: (html: string, jobLifecycleId?: string) =>
      postJsonOverUds(
        {
          socketPath,
          path: `/internal/ingest${jobLifecycleId ? '?webhook=true' : ''}`,
          headers: { 'x-internal-token': token },
        },
        { html, jobLifecycleId }
      ),
    action: (jobLifecycleId: string, action: string) =>
      postJsonOverUds(
        { socketPath, path: '/internal/action', headers: { 'x-internal-token': token } },
        { jobLifecycleId, action }
      ),
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
