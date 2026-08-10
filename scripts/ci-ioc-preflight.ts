/**
 * CI runner-readiness pre-flight gate.
 *
 * Runs BEFORE the test suite (CI step order: `npm run test:preflight` then
 * `npm run test:full`). Validates the IoC runner prerequisites needed by the
 * integration/e2e suites so tests never silently skip on a missing runner:
 *   1. mongod / mongodb-memory-server  (backing createTestStorage)
 *   2. RabbitMQ reachable              (live backing for path/e2e)
 *   3. Playwright chromium installed   (browser scheduler + PDF assets)
 *   4. Unix-domain-socket bind         (tui-boundary UDS)
 *
 * Exits 0 when ready; prints a clear reason and exits nonzero otherwise.
 */
import fs from 'node:fs';
import net from 'node:net';

import amqplib from 'amqplib';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { chromium } from 'playwright-extra';

const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

let failures = 0;

function fail(step: string, detail: string): void {
  failures++;
  console.error(`[preflight] FAIL ${step}: ${detail}`);
}

function ok(step: string, detail: string): void {
  console.log(`[preflight] ok   ${step}: ${detail}`);
}

async function checkMongod(): Promise<void> {
  try {
    const mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    if (!uri) fail('mongod/mongodb-memory-server', 'create() produced no URI');
    else ok('mongod/mongodb-memory-server', 'in-memory launch ok');
    await mongod.stop();
  } catch (e) {
    fail('mongod/mongodb-memory-server', e instanceof Error ? e.message : String(e));
  }
}

async function checkRabbitMq(): Promise<void> {
  try {
    const conn = await amqplib.connect(RMQ_URL);
    await conn.close();
    ok('rabbitmq', `reachable (${RMQ_URL})`);
  } catch (e) {
    fail('rabbitmq', e instanceof Error ? e.message : String(e));
  }
}

async function checkChromium(): Promise<void> {
  try {
    const execPath = chromium.executablePath();
    if (fs.existsSync(execPath)) ok('playwright/chromium', execPath);
    else fail('playwright/chromium', `executable not found: ${execPath}`);
  } catch (e) {
    fail('playwright/chromium', e instanceof Error ? e.message : String(e));
  }
}

async function checkUds(): Promise<void> {
  const sock = `/tmp/jobs-watcher-preflight-${process.pid}.sock`;
  try {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(sock, () => {
        server.close(() => {
          try {
            fs.unlinkSync(sock);
          } catch {
            /* best-effort */
          }
          resolve();
        });
      });
    });
    ok('uds', 'socket bind/close ok');
  } catch (e) {
    fail('uds', e instanceof Error ? e.message : String(e));
  }
}

async function main(): Promise<void> {
  console.log('[preflight] CI runner-readiness gate (mongod, rabbitmq, chromium, uds)');
  await checkMongod();
  await checkRabbitMq();
  await checkChromium();
  await checkUds();
  if (failures > 0) {
    console.error(
      `[preflight] ${failures} prerequisite check(s) failed — refusing to run the suite.`
    );
    process.exit(1);
  }
  console.log('[preflight] all runner prerequisites ready.');
}

void main();
