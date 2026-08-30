/* eslint-disable @typescript-eslint/no-unused-vars, vitest/expect-expect, no-async-promise-executor */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { buildDaemonContainer } from '../../../src/application/container.js';
import { ActionEvent } from '../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import type { UdsAdapter } from '../../../src/infrastructure/inbound/uds/uds-adapter.js';
import { postJsonOverUds } from '../../../src/infrastructure/utils/uds-http.js';
import { setQueueMode, resetState } from '../../../src/presentation/tui/shared-tui-state.js';
import { linkedinSduiDetailHtml } from '../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../helpers/test-builders.js';
import {
  buildTestDaemonContainer,
  buildTestTuiContainer,
  type TestDaemonContainer,
  type TuiTestContainer,
} from '../../helpers/test-container.js';
import { waitFor } from '../../helpers/test-utils.js';

const TOKEN = 'e2e-internal-token';
const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

/**
 * UdsAdapter contract through the production composition root: the real UDS
 * endpoint (listening on the daemon container socket) forwards to the real
 * JobIngestor (real Mongo + real RMQ adapters). HTTP boundary semantics and
 * the S2/S3 forwarding effects are asserted on the real socket and the real
 * wired-up bus — no `vi.fn`, no adapter ports are mocked. The asset slot is
 * scripted to keep [j] resolution from triggering the heavyweight artifact
 * build; the ingestor under test is otherwise real.
 */
describe('UdsAdapter contract — real UDS endpoint over testdaemoncontainer (real ingestor)', () => {
  let daemon: TestDaemonContainer;
  let tui: TuiTestContainer;
  let socketDir: string;
  let socketPath: string;
  let adapter: UdsAdapter;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer(
      { ns: 'uds-adapter' },
      { ports: { assetProducing: { toAsset: async () => ({}) } } }
    );
    await daemon.start();
    tui = await buildTestTuiContainer({ ns: 'uds-adapter' });
    socketDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uds-adapter-'));
    socketPath = path.join(socketDir, 'ingest.sock');
  }, 120000);

  afterAll(async () => {
    await tui.stop();
    await daemon.stop();
    try {
      fs.rmSync(socketDir, { recursive: true, force: true });
    } catch {}
  });

  beforeEach(async () => {
    await daemon.storage.clearDb();
    await tui.reader.purgeQueues();
    tui.reader.resetReader();
    resetState();
    setQueueMode(true);
    // Fencing: ensure RMQ→IPC convergence from previous test is drained before next test starts.
    await waitFor(() => tui.reader.getQueueDepth() === 0, 2000).catch(() => {});
    await waitFor(() => tui.ipc.read().jobLifecycleId === null, 2000).catch(() => {});
  });

  /** Real UdsAdapter on a temp socket bound to the real container ingestor. */
  function bootLifecycleAdapter(socket: string): UdsAdapter {
    const container = buildDaemonContainer(
      {
        nodeEnv: 'test',
        mongodb: { uri: daemon.storage.uri, dbName: daemon.storage.dbName },
        rabbitmq: { url: RMQ_URL, exchange: daemon.rmq.exchange },
        uds: { socketPath: socket, token: TOKEN },
        health: { port: 0 },
        asset: { outputDir: '/tmp/jobs-watcher-uds-assets' },
      },
      {
        ports: {
          ingestor: {
            processIngest: daemon.apps.ingest.processIngest,
            processResolution: daemon.apps.ingest.processResolution,
          },
        },
      }
    );
    return container.udsAdapter;
  }

  async function expectNoEvent(key: ActionEvent, timeoutMs = 3000): Promise<void> {
    await expect(
      waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED, timeoutMs)
    ).rejects.toThrow(/timed out/);
  }

  function sendRaw(
    socketPath: string,
    url: string,
    method: string,
    body: string,
    headers?: Record<string, string>
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath,
        path: url,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          ...headers,
        },
      };
      const req = http.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks).toString() })
        );
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }

  // — (a) lifecycle — socket file lifecycle on the real UdsAdapter —

  it('GIVEN the UdsAdapter precondition WHEN start on the real UdsAdapter THEN start creates the socket file', async () => {
    adapter = bootLifecycleAdapter(socketPath);
    expect(fs.existsSync(socketPath)).toBe(false);
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);
    await adapter.stop().catch(() => {});
  });

  it('GIVEN the UdsAdapter precondition WHEN start → stop on the real UdsAdapter THEN stop removes the socket file', async () => {
    adapter = bootLifecycleAdapter(socketPath);
    await adapter.start();
    expect(fs.existsSync(socketPath)).toBe(true);
    await adapter.stop();
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('GIVEN the UdsAdapter precondition WHEN stop is called twice on the real UdsAdapter THEN the second stop is safe', async () => {
    adapter = bootLifecycleAdapter(socketPath);
    await adapter.start();
    await adapter.stop();
    await expect(adapter.stop()).resolves.toBeUndefined();
  });

  it('GIVEN the UdsAdapter precondition WHEN start → stop → start on the real UdsAdapter THEN restart serves requests again', async () => {
    adapter = bootLifecycleAdapter(socketPath);
    await adapter.start();
    await adapter.stop();
    await adapter.start();

    const res = await postJsonOverUds(
      {
        socketPath,
        path: '/internal/action',
        headers: { 'x-internal-token': TOKEN },
        timeoutMs: 5000,
      },
      { action: 'queue', jobLifecycleId: 'restart-test' }
    );
    expect(res.statusCode).toBe(202);
  });

  // — (b) POST /internal/ingest — real S2 forwarding (clip-* + PARSE_COMPLETED) —

  it('GIVEN the UDS precondition WHEN a valid ingest is posted on the real UDS THEN 200 and a clip-* doc is persisted with PARSE_COMPLETED on the real bus (S2)', async () => {
    const { setQueueMode } = await import('../../../src/presentation/tui/shared-tui-state.js');
    setQueueMode(false);
    const html = linkedinSduiDetailHtml('Uds Ingest Role', 'UdsIngestCo');

    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest',
        headers: { 'x-internal-token': TOKEN },
      },
      { html }
    );
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).status).toBe('accepted');

    await waitFor(() => tui.ipc.read().stage === JobStage.FULL_PARSED);
    const cur = tui.ipc.read();
    expect(cur.jobLifecycleId).toMatch(/^clip-/);
    expect(cur.job?.role).toBe('Uds Ingest Role');
    expect(cur.job?.company).toBe('UdsIngestCo');
    expect(cur.stage).toBe(JobStage.FULL_PARSED);
    setQueueMode(true);

    const doc = await daemon.jobLifecycle.findById(cur.jobLifecycleId!);
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('GIVEN a seeded stage-1 doc WHEN a webhook ingest with jobLifecycleId is posted on the real UDS THEN 200, s2a preserves s1 fields and PARSE_COMPLETED carries the given id (S2)', async () => {
    await daemon.storage.clearDb();
    await daemon.jobLifecycle.upsert(
      makeStage1Partial({
        _id: 'uds-upgrade-1',
        role: 'Webhook Upgrade Role',
        company: 'WebhookUpgradeCo',
      })
    );
    const html = linkedinSduiDetailHtml('Webhook Upgrade Role', 'WebhookUpgradeCo');

    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest?webhook=true',
        headers: { 'x-internal-token': TOKEN },
      },
      { html, jobLifecycleId: 'uds-upgrade-1' }
    );
    expect(res.statusCode).toBe(202);

    // S2a via webhook is queue-mode deferred (no S1 pending for this id), so assert via DB, not ipc.
    await new Promise<void>(async (resolve, reject) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const doc = await daemon.jobLifecycle.findById('uds-upgrade-1');
        if (doc?.stage === JobStage.FULL_PARSED && doc?.company === 'WebhookUpgradeCo')
          return resolve();
        await new Promise((r) => setTimeout(r, 100));
      }
      reject(new Error('waitFor DB FULL_PARSED timed out'));
    });
    const doc = await daemon.jobLifecycle.findById('uds-upgrade-1');
    expect(doc?.company).toBe('WebhookUpgradeCo');
    expect(doc?.stage).toBe(JobStage.FULL_PARSED);
  });

  it('GIVEN the UDS precondition WHEN a webhook ingest with empty html is posted on the real UDS THEN 400 with Empty html payload', async () => {
    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest?webhook=true',
        headers: { 'x-internal-token': TOKEN },
      },
      { html: '' }
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Empty html payload');
  });

  it('GIVEN the UDS precondition WHEN a plain ingest with empty html is posted on the real UDS THEN 400 and no PARSE_COMPLETED', async () => {
    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest',
        headers: { 'x-internal-token': TOKEN },
      },
      { html: '' }
    );
    expect(res.statusCode).toBe(400);
    await expectNoEvent(ActionEvent.PARSE_COMPLETED);
  });

  // — (c) POST /internal/action — real S3 resolution forwarding —

  async function seedClip(role: string, company: string): Promise<string> {
    setQueueMode(false);
    await daemon.apps.ingest.processIngest(
      JobSource.MANUAL,
      JobStage.FULL_PARSED,
      linkedinSduiDetailHtml(role, company)
    );
    await waitFor(
      () =>
        tui.ipc.read().stage === JobStage.FULL_PARSED &&
        tui.ipc.read().jobLifecycleId !== null &&
        tui.ipc.read().jobLifecycleId!.startsWith('clip-'),
      20000
    );
    return tui.ipc.read().jobLifecycleId as string;
  }

  it('GIVEN the UDS precondition WHEN a queue action is posted on the real UDS THEN 200 and QUEUED is emitted with the job id (S3)', async () => {
    const id = await seedClip('Queue Role', 'QueueCo');
    await waitFor(() => tui.ipc.read().jobLifecycleId === id);

    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/action',
        headers: { 'x-internal-token': TOKEN },
      },
      { jobLifecycleId: id, action: 'queue' }
    );
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).status).toBe('accepted');

    await waitFor(() => tui.ipc.read().jobLifecycleId === null, 30000);
    expect(tui.ipc.read().job).toBeNull();
    const doc = await daemon.jobLifecycle.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN the UDS precondition WHEN a trash action is posted on the real UDS THEN 200 and TRASHED is emitted with the job id (S3)', async () => {
    const id = await seedClip('Trash Role', 'TrashCo');
    await waitFor(() => tui.ipc.read().jobLifecycleId === id);

    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/action',
        headers: { 'x-internal-token': TOKEN },
      },
      { jobLifecycleId: id, action: 'trash' }
    );
    expect(res.statusCode).toBe(202);

    await waitFor(() => tui.ipc.read().jobLifecycleId === null, 30000);
    expect(tui.ipc.read().job).toBeNull();
    const doc = await daemon.jobLifecycle.findById(id);
    expect(doc!.status).toBe(JobStatus.TRASHED);
  });

  it('GIVEN the UDS precondition WHEN a queue action with editedKVs is posted on the real UDS THEN 200 and QUEUED is emitted', async () => {
    const id = await seedClip('Edited Role', 'EditedCo');
    await waitFor(() => tui.ipc.read().jobLifecycleId === id);

    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/action',
        headers: { 'x-internal-token': TOKEN },
      },
      {
        jobLifecycleId: id,
        action: 'queue',
        editedKVs: { role: 'Updated Role', salary: '$2000' },
      }
    );
    expect(res.statusCode).toBe(202);

    await waitFor(() => tui.ipc.read().jobLifecycleId === null);
    expect(tui.ipc.read().job).toBeNull();
  });

  it('GIVEN the UDS precondition WHEN an action missing jobLifecycleId is posted on the real UDS THEN 400 with Missing jobLifecycleId or action', async () => {
    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/action',
        headers: { 'x-internal-token': TOKEN },
      },
      { action: 'queue' }
    );
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Missing jobLifecycleId or action');
  });

  // — (d) payload boundary — malformed, empty, large, chunked and concurrent bodies —

  it('GIVEN the UDS precondition WHEN invalid JSON is posted on the real UDS THEN 500 with Internal server error', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'POST', 'not-json-at-all', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('Internal server error');
  });

  it('GIVEN the UDS precondition WHEN invalid JSON is posted on /internal/action on the real UDS THEN 500', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/action', 'POST', '{invalid json!!!}', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(500);
  });

  it('GIVEN the UDS precondition WHEN an empty body is posted on the real UDS THEN 500', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'POST', '', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(500);
  });

  it('GIVEN the UDS precondition WHEN a null body is posted on the real UDS THEN 500', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'POST', 'null', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(500);
  });

  it('GIVEN the UDS precondition WHEN an empty JSON object is posted on the real UDS THEN 400', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'POST', '{}', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(400);
  });

  it('GIVEN the UDS precondition WHEN a large HTML payload is posted on the real UDS THEN 200 with ok status', async () => {
    const largeHtml = '<html>' + 'x'.repeat(50000) + '</html>';
    const res = await sendRaw(
      daemon.uds.socket,
      '/internal/ingest',
      'POST',
      JSON.stringify({ html: largeHtml }),
      { 'x-internal-token': TOKEN }
    );
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).status).toBe('accepted');
  });

  it('GIVEN the UDS precondition WHEN a chunked body is posted on the real UDS THEN 200 with ok status', async () => {
    const chunks = ['{"html":', '"<html>', 'chunked', '</html>', '"}'];
    const fullBody = chunks.join('');
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(fullBody),
          'x-internal-token': TOKEN,
        },
      };
      const req = http.request(options, (response) => {
        const bufs: Buffer[] = [];
        response.on('data', (c) => bufs.push(Buffer.from(c)));
        response.on('end', () =>
          resolve({ statusCode: response.statusCode || 0, body: Buffer.concat(bufs).toString() })
        );
      });
      req.on('error', reject);
      for (const chunk of chunks) req.write(chunk);
      req.end();
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).status).toBe('accepted');
  });

  it('GIVEN the UDS precondition WHEN concurrent requests hit the real UDS THEN all return 200', async () => {
    const payloads = [
      { html: '<html>job1</html>', jobLifecycleId: 'concurrent-1' },
      { html: '<html>job2</html>', jobLifecycleId: 'concurrent-2' },
      { html: '<html>job3</html>', jobLifecycleId: 'concurrent-3' },
    ];
    const results = await Promise.all(
      payloads.map((p) =>
        postJsonOverUds(
          {
            socketPath: daemon.uds.socket,
            path: '/internal/ingest',
            headers: { 'x-internal-token': TOKEN },
          },
          p
        )
      )
    );
    results.forEach((r) => expect(r.statusCode).toBe(202));
  });

  // — (e) auth boundary — x-internal-token on the real UDS —

  it('GIVEN the UDS precondition WHEN no token header is sent THEN 401 with Unauthorized', async () => {
    const res = await postJsonOverUds(
      { socketPath: daemon.uds.socket, path: '/internal/ingest' },
      { html: '<html/>' }
    );
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('Unauthorized');
  });

  it('GIVEN the UDS precondition WHEN an empty token header is sent THEN 401', async () => {
    const res = await sendRaw(
      daemon.uds.socket,
      '/internal/ingest',
      'POST',
      JSON.stringify({ html: '<html/>' }),
      { 'x-internal-token': '' }
    );
    expect(res.statusCode).toBe(401);
  });

  it('GIVEN the UDS precondition WHEN a whitespace-only token header is sent THEN 401', async () => {
    const res = await sendRaw(
      daemon.uds.socket,
      '/internal/ingest',
      'POST',
      JSON.stringify({ html: '<html/>' }),
      { 'x-internal-token': '   ' }
    );
    expect(res.statusCode).toBe(401);
  });

  it('GIVEN the UDS precondition WHEN a wrong token header is sent THEN 401', async () => {
    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest',
        headers: { 'x-internal-token': 'wrong' },
      },
      { html: '<html/>' }
    );
    expect(res.statusCode).toBe(401);
  });

  it('GIVEN the UDS precondition WHEN the correct token header is sent THEN 200', async () => {
    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/ingest',
        headers: { 'x-internal-token': TOKEN },
      },
      { html: '<html/>' }
    );
    expect(res.statusCode).toBe(202);
  });

  // — (f) HTTP method + route boundary on the real UDS —

  it('GIVEN the UDS precondition WHEN a GET request hits /internal/ingest THEN 404', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'GET', '', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GIVEN the UDS precondition WHEN a PUT request hits /internal/ingest THEN 404', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'PUT', '{}', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GIVEN the UDS precondition WHEN a DELETE request hits /internal/ingest THEN 404', async () => {
    const res = await sendRaw(daemon.uds.socket, '/internal/ingest', 'DELETE', '', {
      'x-internal-token': TOKEN,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GIVEN the UDS precondition WHEN an unknown path is posted THEN 404', async () => {
    const res = await postJsonOverUds(
      {
        socketPath: daemon.uds.socket,
        path: '/internal/unknown',
        headers: { 'x-internal-token': TOKEN },
      },
      {}
    );
    expect(res.statusCode).toBe(404);
  });
});
