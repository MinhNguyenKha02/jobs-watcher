import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fc from 'fast-check';
import { createTestStorage } from '../../helpers/create-test-storage.js';
import { createParseEventPort, createRoutingPort } from '../../helpers/mock-ports.js';
import { MongoJobLifecycleAdapter } from '../../../src/infrastructure/outbound/persistence/mongo-job-lifecycle-adapter.js';
import { MongoInitializer } from '../../../src/infrastructure/outbound/persistence/mongo-init.js';
import { JobIngestor } from '../../../src/application/ingestor.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import { topcvEmailHtmlMany, topcvDetailHtml } from '../../helpers/html-fixtures.js';

const ROLES = ['Software Engineer', 'Backend Developer', 'Full Stack Developer', 'Data Engineer'];

describe('PRC-001 — Saga state machine invariants (property-based)', () => {
  let storage: Awaited<ReturnType<typeof createTestStorage>>;
  let adapter: MongoJobLifecycleAdapter;
  let ingestor: JobIngestor;
  let parseEvents: string[];
  let routingEvents: string[];
  let dbCollection: any;

  beforeAll(async () => {
    storage = await createTestStorage();
    const initializer = new MongoInitializer(storage.client, storage.dbName);
    await initializer.init();
    adapter = new MongoJobLifecycleAdapter(storage.client.db(storage.dbName));
    dbCollection = storage.client.db(storage.dbName).collection('job_lifecycle');
  }, 120000);

  beforeEach(async () => {
    await storage.clearDb();
    parseEvents = [];
    routingEvents = [];
    const parseEventPort = createParseEventPort((tag) => parseEvents.push(tag));
    const routingPort = createRoutingPort((tag) => routingEvents.push(tag));
    ingestor = new JobIngestor(adapter, parseEventPort, routingPort);
  });

  afterAll(async () => {
    await storage.stop();
  });

  it('s1 pre-req invariant: s1 creates partial_parsed/enriching doc, then s2 merges to full_parsed/enriched', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'SagaAlphaCo' }]), undefined, { messageId: 'msg-saga-alpha' });
    const s1Doc = await adapter.findById('msg-saga-alpha-job-0');
    expect(s1Doc).not.toBeNull();
    expect(s1Doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    expect(s1Doc!.status).toBe(JobStatus.ENRICHING);

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'SagaAlphaCo'), 'msg-saga-alpha-job-0');

    const s2Doc = await adapter.findById('msg-saga-alpha-job-0');
    expect(s2Doc).not.toBeNull();
    expect(s2Doc!.stage).toBe(JobStage.FULL_PARSED);
    expect(s2Doc!.status).toBe(JobStatus.ENRICHED);
  });

  it('s2(b) standalone invariant: [i] direct mode FULL_PARSED needs no s1 and produces clip-* doc + completed event', async () => {
    const before = parseEvents.filter(e => e === 'completed').length;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Backend Developer', 'SoloCo'));
    const completedAfter = parseEvents.filter(e => e === 'completed').length;
    expect(completedAfter).toBe(before + 1);

    const docs = await dbCollection.find({ _id: { $regex: '^clip-' } }).toArray();
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs[0].stage).toBe(JobStage.FULL_PARSED);
    expect(docs[0].status).toBe(JobStatus.ENRICHED);
  });

  it('[j] queue guard invariant: queue accepted only when status ENRICHED (s2 full_parsed)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Data Engineer', company: 'GuardCo' }]), undefined, { messageId: 'msg-guard' });
    const s1Id = 'msg-guard-job-0';
    const s1Doc = await adapter.findById(s1Id);
    expect(s1Doc!.status).toBe(JobStatus.ENRICHING);

    routingEvents.length = 0;
    await ingestor.processResolution(s1Id, 'queue');

    const s1After = await adapter.findById(s1Id);
    expect(s1After!.status).toBe(JobStatus.ENRICHING);
    expect(routingEvents.filter(e => e === 'queued').length).toBe(0);
  });

  it('[j] queue accepted after s2 enrichment (status ENRICHED → QUEUED)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'QueueCo' }]), undefined, { messageId: 'msg-queue-guard' });
    const id = 'msg-queue-guard-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'QueueCo'), id);

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'queue');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
    expect(routingEvents.filter(e => e === 'queued').length).toBe(1);
  });

  it('[d] trash accepted at s1 (partial_parsed) without s2', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Web Developer', company: 'TrashS1Co' }]), undefined, { messageId: 'msg-trash-s1' });
    const id = 'msg-trash-s1-job-0';

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'trash');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.TRASHED);
    expect(routingEvents.filter(e => e === 'trashed').length).toBe(1);
  });

  it('completion invariant: s3 is terminal — replaying queue after queue is a no-op', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'TerminalCo' }]), undefined, { messageId: 'msg-terminal' });
    const id = 'msg-terminal-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Backend Developer', 'TerminalCo'), id);
    await ingestor.processResolution(id, 'queue');

    routingEvents.length = 0;
    await ingestor.processResolution(id, 'queue');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
    expect(routingEvents.length).toBe(0);
  });

  it('s4 invariant: trash-after-queue must not overwrite terminal QUEUED state (completion is terminal)', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Full Stack Developer', company: 'TerminalCo2' }]), undefined, { messageId: 'msg-terminal2' });
    const id = 'msg-terminal2-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Full Stack Developer', 'TerminalCo2'), id);
    await ingestor.processResolution(id, 'queue');

    await ingestor.processResolution(id, 'trash');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
  });

  it('failure invariant: empty payload at s2 emits failed → saga moves on (s4)', async () => {
    parseEvents.length = 0;
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', 'empty-saga-id');
    expect(parseEvents.filter(e => e === 'failed').length).toBe(1);
  });

  it('s1[] many invariant: one gmail body with multiple job records creates one doc per job', async () => {
    const multiHtml = topcvEmailHtmlMany([
      { role: 'Software Engineer', company: 'MultiCoOne' },
      { role: 'Backend Developer', company: 'MultiCoTwo' },
    ]);

    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, multiHtml, undefined, { messageId: 'msg-multi' });

    const created = await dbCollection.find({ _id: { $regex: '^msg-multi-job-' } }).toArray();
    expect(created.length).toBeGreaterThanOrEqual(2);
  });

  it('s2 merge invariant: s2 payload merges over s1 without losing gmailMeta', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'MergeCo' }]), undefined, { messageId: 'msg-merge', subject: 'merge-subject' });
    const id = 'msg-merge-job-0';

    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'MergeCo'), id);

    const doc = await adapter.findById(id);
    expect(doc!.gmailMeta).toBeDefined();
    expect(doc!.gmailMeta!.subject).toBe('merge-subject');
    expect(doc!.raw).toContain('job-detail');
  });

  it('property: random role/company pairs never crash the saga and always converge to valid states', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ROLES),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 9 }),
        async (role, company, workerIdx) => {
          const safeCompany = company.replace(/[<>&]/g, '') || 'Co';
          await ingestor.processIngest(
            JobSource.BROWSER_AUTO,
            JobStage.PARTIAL_PARSED,
            topcvEmailHtmlMany([{ role, company: `${safeCompany}${workerIdx}` }]),
            undefined,
            { messageId: `prop-${workerIdx}-${role.replace(/\s+/g, '')}` },
          );
          const doc = await adapter.findById(`prop-${workerIdx}-${role.replace(/\s+/g, '')}-job-0`);
          if (doc) {
            expect([JobStatus.ENRICHING, JobStatus.ENRICHED]).toContain(doc.status);
          }
          return true;
        },
      ),
      { numRuns: 30 },
    );
  });

  it('property: repeated identical s1 ingests are idempotent (dedupe on role+company)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...ROLES),
        async (role) => {
          const company = `DedupePropCo-${Math.random().toString(36).slice(2, 8)}`;
          await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role, company }]), undefined, { messageId: 'prop-dedupe' });
          await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role, company }]), undefined, { messageId: 'prop-dedupe' });
          const docs = await dbCollection.find({ role, company }).toArray();
          expect(docs.length).toBeLessThanOrEqual(1);
          return true;
        },
      ),
      { numRuns: 15 },
    );
  });

  it('s3 completion invariant: queued doc persists stage full_parsed + status queued for asset pipeline', async () => {
    await ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'AssetSagaCo' }]), undefined, { messageId: 'msg-asset-saga' });
    const id = 'msg-asset-saga-job-0';
    await ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'AssetSagaCo'), id);
    await ingestor.processResolution(id, 'queue');

    const doc = await adapter.findById(id);
    expect(doc!.status).toBe(JobStatus.QUEUED);
    expect(doc!.stage).toBe(JobStage.FULL_PARSED);
  });
});
