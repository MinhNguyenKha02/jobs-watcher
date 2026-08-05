import http from 'http';
import fs from 'node:fs';
import { type Channel } from 'amqplib';
import { AssetProducingAdapter } from '../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { postJsonOverUds } from '../../src/infrastructure/utils/uds-http.js';

export const RMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

/** Fresh exclusive queue bound to the desired routing keys at consume-time. */
export async function setupConsumer(ch: Channel, exchange: string, routingKeys: string[]): Promise<{ consume: Promise<any> }> {
  const { queue } = await ch.assertQueue('', { exclusive: true });
  for (const key of routingKeys) {
    await ch.bindQueue(queue, exchange, key);
  }
  const consume = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout waiting for message on ${exchange}:${routingKeys.join('|')}`)), 10000);
    ch.consume(queue, (msg) => {
      if (msg) {
        clearTimeout(timeout);
        ch.ack(msg);
        resolve(JSON.parse(msg.content.toString()));
      }
    }, { noAck: false });
  });
  return { consume };
}

/** Real `AssetProducingAdapter` rendering into a temp dir so the repo's ./assets is untouched. */
export class TempDirAssetAdapter {
  private inner = new AssetProducingAdapter();
  pdfPath: string | null = null;
  constructor(private outputDir: string) {}

  async toAsset(resolved: any, _outputDir?: string) {
    const result = await this.inner.toAsset(resolved, this.outputDir);
    this.pdfPath = result.pdfPath ?? null;
    return result;
  }
}

export function waitForAsset(adapter: TempDirAssetAdapter, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const poll = () => {
      if (adapter.pdfPath && fs.existsSync(adapter.pdfPath)) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Timeout waiting for asset pdf'));
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
        { socketPath, path: `/internal/ingest${jobLifecycleId ? '?webhook=true' : ''}`, headers: { 'x-internal-token': token } },
        { html, jobLifecycleId },
      ),
    action: (jobLifecycleId: string, action: string) =>
      postJsonOverUds(
        { socketPath, path: '/internal/action', headers: { 'x-internal-token': token } },
        { jobLifecycleId, action },
      ),
  };
}

export function postJson(port: number, pathName: string, body: unknown): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: pathName, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
