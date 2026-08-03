import { describe, it, expect } from 'vitest';
import type { IngestorPort } from '../../../src/application/ports/inbound/ingestor.port.js';
import type { ParsePort } from '../../../src/application/ports/parse.port.js';
import type { RoutePort } from '../../../src/application/ports/route.port.js';
import type { JobLifecyclePort } from '../../../src/application/ports/job-lifecycle.port.js';
import type { ExtractionQueuePort } from '../../../src/application/ports/extraction-queue.port.js';
import type { AssetProducingPort } from '../../../src/application/ports/asset-producing.port.js';
import type { BrowserPort } from '../../../src/application/ports/browser.port.js';
import { JobIngestor } from '../../../src/application/ingestor.js';
import { ExtractionScheduler } from '../../../src/application/extraction-scheduler.js';
import { UdsAdapter } from '../../../src/infrastructure/inbound/uds/uds-adapter.js';
import { WebhookAdapter } from '../../../src/infrastructure/inbound/web/webhook-adapter.js';
import { MongoJobLifecycleAdapter } from '../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoExtractionQueueAdapter } from '../../../src/infrastructure/outbound/persistence/mongo-extraction-queue-adapter.js';
import { RabbitMqConnection } from '../../../src/infrastructure/outbound/rabbitmq/rabbitmq-connection.js';
import { RabbitMqParseAdapter } from '../../../src/infrastructure/outbound/rabbitmq/rabbitmq-parse-adapter.js';
import { RabbitMqRoutingAdapter } from '../../../src/infrastructure/outbound/rabbitmq/rabbitmq-route-adapter.js';
import { AssetProducingAdapter } from '../../../src/infrastructure/outbound/asset-builder/asset-producing-adapter.js';
import { PlaywrightBrowserAdapter } from '../../../src/infrastructure/outbound/browser/browser-adapter.js';
import { JobStage, JobSource } from '../../../src/domain/types/job-lifecycle.js';

// Compile-time conformance: each adapter's public shape must satisfy its port interface.
// Violations fail type-check (npm run type-check / tsc), which is the DIP gate.
// Runtime checks below assert the class prototype exposes the port methods.
type Proto = Record<string, unknown>;

function protoOf(cls: any): Proto {
  return (cls.prototype ?? {}) as Proto;
}

const ingestorProto = protoOf(JobIngestor);
const lifecycleProto = protoOf(MongoJobLifecycleAdapter);
const queueProto = protoOf(MongoExtractionQueueAdapter);
const parseProto = protoOf(RabbitMqParseAdapter);
const routeProto = protoOf(RabbitMqRoutingAdapter);
const browserProto = protoOf(PlaywrightBrowserAdapter);

describe('PRC-DIP — Dependency inversion: adapters depend on ports, not implementations', () => {
  it('JobIngestor satisfies IngestorPort (processIngest + processResolution)', () => {
    expect(typeof ingestorProto.processIngest).toBe('function');
    expect(typeof ingestorProto.processResolution).toBe('function');
  });

  it('MongoJobLifecycleAdapter satisfies JobLifecyclePort (upsert/updateStage/findById)', () => {
    expect(typeof lifecycleProto.upsert).toBe('function');
    expect(typeof lifecycleProto.updateStage).toBe('function');
    expect(typeof lifecycleProto.findById).toBe('function');
  });

  it('MongoExtractionQueueAdapter satisfies ExtractionQueuePort (enqueue/dequeue/size/onEnqueue)', () => {
    expect(typeof queueProto.enqueue).toBe('function');
    expect(typeof queueProto.dequeue).toBe('function');
    expect(typeof queueProto.size).toBe('function');
    expect(typeof queueProto.onEnqueue).toBe('function');
  });

  it('RabbitMqParseAdapter satisfies ParsePort (emitGenerated/emitCompleted/emitFailed)', () => {
    expect(typeof parseProto.emitGenerated).toBe('function');
    expect(typeof parseProto.emitCompleted).toBe('function');
    expect(typeof parseProto.emitFailed).toBe('function');
  });

  it('RabbitMqRoutingAdapter satisfies RoutePort (emitJobQueued/emitJobTrashed/emitRouteFailed)', () => {
    expect(typeof routeProto.emitJobQueued).toBe('function');
    expect(typeof routeProto.emitJobTrashed).toBe('function');
    expect(typeof routeProto.emitRouteFailed).toBe('function');
  });

  it('PlaywrightBrowserAdapter satisfies BrowserPort (start/extract/stop)', () => {
    expect(typeof browserProto.start).toBe('function');
    expect(typeof browserProto.extract).toBe('function');
    expect(typeof browserProto.stop).toBe('function');
  });

  it('ExtractionScheduler accepts any IngestorPort (not concrete JobIngestor)', () => {
    const scheduler = new ExtractionScheduler(
      {} as ExtractionQueuePort,
      {} as BrowserPort,
      {} as JobLifecyclePort,
      { processIngest: async () => {}, processResolution: async () => {} } as IngestorPort,
    );
    expect(scheduler).toBeDefined();
  });

  it('UdsAdapter accepts IngestorPort in constructor', () => {
    const adapter = new UdsAdapter(
      { processIngest: async () => {}, processResolution: async () => {} } as IngestorPort,
      { socketPath: '/tmp/dip-test.sock', token: 'x' } as any,
    );
    expect(adapter).toBeDefined();
  });

  it('WebhookAdapter accepts IngestorPort + GmailClient in constructor', () => {
    const adapter = new WebhookAdapter(
      { processIngest: async () => {}, processResolution: async () => {} } as IngestorPort,
      {} as any,
    );
    expect(adapter).toBeDefined();
  });

  it('AssetProducingAdapter satisfies AssetProducingPort (toAsset)', () => {
    const adapter = new AssetProducingAdapter();
    expect(typeof adapter.toAsset).toBe('function');
  });

  it('RabbitMqConnection exposes channel + exchange for adapter wiring', () => {
    const conn = new RabbitMqConnection({ url: 'amqp://localhost', exchange: 'jobs.events' });
    expect(typeof conn.getChannel).toBe('function');
    expect(typeof conn.getExchange).toBe('function');
  });

  it('IngestorPort contract: processIngest signature accepts all 4 signal cases at compile time', async () => {
    const port = {
      processIngest: async (source: JobSource, stage: JobStage, raw: string, id?: string) => {},
      processResolution: async () => {},
    } satisfies IngestorPort;
    expect(port.processIngest).toBeDefined();
  });
});
