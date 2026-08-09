/* Path cell (c1): S1 uds+ingestor+job_lifecycle; [o][p][c] deep-parse S2; [j]/[d] over UDS (see plans/tests-path-matrix.md) */
import fc from 'fast-check';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { ActionEvent } from '../../../../src/domain/types/action-event.js';
import { JobStage, JobSource, JobStatus } from '../../../../src/domain/types/job-lifecycle.js';
import { udsHelpers } from '../../../helpers/e2e-harness.js';
import { topcvEmailHtmlMany, topcvDetailHtml, nonJobHtml, linkedinSduiDetailHtml } from '../../../helpers/html-fixtures.js';
import { makeStage1Partial } from '../../../helpers/test-builders.js';
import { createTestContainer, type TestContainer } from '../../../helpers/test-container.js';

const TOPCV_EMAIL_HTML = topcvEmailHtmlMany([{ role: 'Backend Developer', company: 'Case1Co' }]);

const CLIPBOARD_HTML = topcvDetailHtml('Backend Developer', 'Case1Co', {
  salary: '15,000,000 VNĐ',
  location: 'Ho Chi Minh',
});

const DM_HTML = linkedinSduiDetailHtml('Backend Developer', 'ClipJuniorCorp');

describe('c1 full-path — Case 1 partial → [o][p][c] → full → [j]/[d] → next', () => {
  let tc: TestContainer;
  let uds: ReturnType<typeof udsHelpers>;

  beforeAll(async () => {
    tc = await createTestContainer({ ns: 'c1-full-path' });
    await tc.start();
    uds = udsHelpers(tc.socket, 'e2e-internal-token');
  }, 120000);

  afterAll(async () => {
    await tc.stop();
  });

  beforeEach(async () => {
    await tc.storage.clearDb();
  });

  async function seedPartial(overrides: Record<string, unknown> = {}): Promise<string> {
    const doc = makeStage1Partial({ company: 'OldCo', role: 'Backend Developer', ...overrides });
    await tc.mongoJobLifecycleAdapter.upsert(doc);
    return doc._id;
  }

  describe('canonical S1 → [c] paste → [j]/[d] over UDS', () => {
    it('T1a: S1 partial → [c] webhook ingest → [j] queue — canonical Case 1', async () => {
      const messageId = 'c1-msg-1';
      const gen = await tc.bus.setup([ActionEvent.GENERATED]);
      await tc.ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, TOPCV_EMAIL_HTML, undefined, { messageId, subject: 'Backend Developer' });
      const genMsg = await gen.msg();
      const jobLifecycleId: string = genMsg._id;
      expect(jobLifecycleId).toMatch(/-job-0$/);

      const partialDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(partialDoc).not.toBeNull();
      expect(partialDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
      expect(partialDoc!.status).toBe(JobStatus.ENRICHING);

      const ingest = await uds.ingest(CLIPBOARD_HTML, jobLifecycleId);
      expect(ingest.statusCode).toBe(200);

      const enrichedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(enrichedDoc).not.toBeNull();
      expect(enrichedDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(enrichedDoc!.status).toBe(JobStatus.ENRICHED);
      expect(enrichedDoc!.salary).toBe('15,000,000 VNĐ');
      expect(enrichedDoc!.location).toBe('Ho Chi Minh');

      const queue = await tc.bus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
      const action = await uds.action(jobLifecycleId, 'queue');
      expect(action.statusCode).toBe(200);
      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

      const routedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(routedDoc).not.toBeNull();
      expect(routedDoc!.status).toBe(JobStatus.QUEUED);
    });

    it('T1c: S1 → [c] paste → [d] trash via UDS', async () => {
      const messageId = 'c1-msg-trash';
      const gen = await tc.bus.setup([ActionEvent.GENERATED]);
      await tc.ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, TOPCV_EMAIL_HTML, undefined, { messageId, subject: 'Backend Developer' });
      const genMsg = await gen.msg();
      const jobLifecycleId: string = genMsg._id;

      const ingest = await uds.ingest(CLIPBOARD_HTML, jobLifecycleId);
      expect(ingest.statusCode).toBe(200);

      const trash = await tc.bus.setup([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
      const action = await uds.action(jobLifecycleId, 'trash');
      expect(action.statusCode).toBe(200);
      const trashMsg = await trash.msg();
      expect(trashMsg.jobLifecycleId).toBe(jobLifecycleId);
      expect(trashMsg.reason).toBe('operator:trash');

      const trashedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(trashedDoc).not.toBeNull();
      expect(trashedDoc!.status).toBe(JobStatus.TRASHED);
    });

    it('T1b: [j] before S2 arrives is guarded (deferred enrichment) — no state change', async () => {
      const messageId = 'c1-msg-defer';
      await tc.ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, TOPCV_EMAIL_HTML, undefined, { messageId, subject: 'Backend Developer' });

      const docs = await tc.db.collection('job_lifecycle').find({}).toArray();
      const jobLifecycleId: string = String(docs[0]._id);
      expect(docs.length).toBe(1);

      const action = await uds.action(jobLifecycleId, 'queue');
      expect(action.statusCode).toBe(200);

      const guardedDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(guardedDoc).not.toBeNull();
      expect(guardedDoc!.status).toBe(JobStatus.ENRICHING);
      expect(guardedDoc!.stage).toBe(JobStage.PARTIAL_PARSED);
    });
  });

  describe('signal2aManual ([c]) upgrade + S4 failure paths', () => {
    it('[c] upgrades PARTIAL_PARSED to FULL_PARSED with merged fields — real-DIP', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-valid', company: 'OldCo', role: 'Software Engineer' });

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'NewCo'), jobLifecycleId);
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);

      const doc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
      expect(doc!.status).toBe(JobStatus.ENRICHED);
      expect(doc!.company).toBe('NewCo');
      expect(doc!.role).toBe('Software Engineer');
    });

    it('[c] with empty clipboard emits parse.failed (S4 via B1) and keeps doc ENRICHING', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-empty' });

      const fail = await tc.bus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '   ', jobLifecycleId);
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(jobLifecycleId);

      const doc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHING);
      expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    });

    it('[c] with unparsable clipboard emits parse.failed — no doc change', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-noparse' });

      const fail = await tc.bus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, nonJobHtml(), jobLifecycleId);
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(jobLifecycleId);

      const doc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.ENRICHING);
    });

    it('[c] with missing stage1Partial builds FULL_PARSED from parsed HTML alone', async () => {
      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'NoPartialCo'), 'c1-missing-partial');
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe('c1-missing-partial');

      const doc = await tc.mongoJobLifecycleAdapter.findById('c1-missing-partial');
      expect(doc).not.toBeNull();
      expect(doc!.company).toBe('NoPartialCo');
      expect(doc!.role).toBe('Software Engineer');
      expect(doc!.stage).toBe(JobStage.FULL_PARSED);
    });

    it('[c] on an already FULL_PARSED job is a no-op (B2 guard)', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-already-full', company: 'AlreadyCo' });
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId);

      const firstDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(firstDoc!.stage).toBe(JobStage.FULL_PARSED);

      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML, jobLifecycleId);

      const secondDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(secondDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(secondDoc!.status).toBe(JobStatus.ENRICHED);
      expect(await tc.db.collection('job_lifecycle').countDocuments({})).toBe(1);
    });

    it('MANUAL FULL without jobLifecycleId is silent — no parse.failed (B9), clip-* doc created', async () => {
      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, CLIPBOARD_HTML);
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toMatch(/^clip-/);

      const fail = await tc.bus.setup([ActionEvent.PARSE_FAILED], 3000);
      await expect(fail.msg()).rejects.toThrow();

      const docs = await tc.db.collection('job_lifecycle').find({}).toArray();
      expect(docs.length).toBe(1);
      expect(docs[0]._id).toMatch(/^clip-/);
    });
  });

  describe('[c] → [j]/[d] completion and S4 → S1 recovery', () => {
    it('[c] then [j] via UDS — queue resolution succeeds', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-queue' });

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'QueueTestCo'), jobLifecycleId);
      await comp.msg();

      const queue = await tc.bus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
      const action = await uds.action(jobLifecycleId, 'queue');
      expect(action.statusCode).toBe(200);
      const queueMsg = await queue.msg();
      expect(queueMsg.jobLifecycleId).toBe(jobLifecycleId);

      const doc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.QUEUED);
    });

    it('[c] then [d] via UDS — trash resolution succeeds', async () => {
      const jobLifecycleId = await seedPartial({ _id: 'c1-2a-trash' });

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'TrashTestCo'), jobLifecycleId);
      await comp.msg();

      const trash = await tc.bus.setup([ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED, ActionEvent.PARSE_FAILED]);
      const action = await uds.action(jobLifecycleId, 'trash');
      expect(action.statusCode).toBe(200);
      const trashMsg = await trash.msg();
      expect(trashMsg.reason).toBe('operator:trash');

      const doc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.status).toBe(JobStatus.TRASHED);
    });

    it('S2 failure (S4) then next S1 still processes — real-DIP', async () => {
      const failedId = await seedPartial({ _id: 'c1-s4-fail' });

      const fail = await tc.bus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '   ', failedId);
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(failedId);

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, topcvDetailHtml('Software Engineer', 'RecoveryCo'));
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job.company).toBe('RecoveryCo');

      const recoveryDoc = await tc.db.collection('job_lifecycle').findOne({ company: 'RecoveryCo' });
      expect(recoveryDoc).not.toBeNull();
      expect(recoveryDoc!.status).toBe(JobStatus.ENRICHED);
    });

    it('route failure (S4) emits route.failed then next S1 recovers — real-DIP', async () => {
      const routeFailId = await seedPartial({ _id: 'c1-s4b-fail', stage: JobStage.FULL_PARSED, status: JobStatus.ENRICHED });

      vi.spyOn(tc.mongoJobLifecycleAdapter, 'updateStage').mockRejectedValueOnce(new Error('DB write conflict'));
      const fail = await tc.bus.setup([ActionEvent.QUEUED, ActionEvent.TRASHED, ActionEvent.ROUTE_FAILED]);
      await tc.ingestor.processResolution(routeFailId, 'queue');
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(routeFailId);
      expect(failMsg.reason).toBe('DB write conflict');
      vi.restoreAllMocks();

      const gen = await tc.bus.setup([ActionEvent.GENERATED]);
      await tc.ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role: 'Software Engineer', company: 'NextAfterRouteFail' }]), undefined, { messageId: 'c1-next-after-route-fail' });
      const genMsg = await gen.msg();
      expect(genMsg.company).toBe('NextAfterRouteFail');
    });
  });

  describe('direct mode signal2a ([c] in merged-DM)', () => {
    it('Signal 2a upgrades PARTIAL_PARSED to FULL_PARSED with merged fields — real-DIP', async () => {
      const jobLifecycleId = 'c1-dm-2a-1';
      const partialDoc = {
        _id: jobLifecycleId,
        raw: '<html><body>partial</body></html>',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        company: 'OldCorp',
        role: 'Backend Developer',
        url: 'https://example.com/job',
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };
      await tc.mongoJobLifecycleAdapter.upsert(partialDoc as any);

      const comp = await tc.bus.setup([ActionEvent.PARSE_COMPLETED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, DM_HTML, jobLifecycleId, undefined, new Date());
      const compMsg = await comp.msg();
      expect(compMsg.job).toBeDefined();
      expect(compMsg.job._id).toBe(jobLifecycleId);

      const fullDoc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(fullDoc).not.toBeNull();
      expect(fullDoc!.stage).toBe(JobStage.FULL_PARSED);
      expect(fullDoc!.status).toBe(JobStatus.ENRICHED);
      expect(fullDoc!.company).toBe('ClipJuniorCorp');
      expect(fullDoc!.role).toBe('Backend Developer');
      expect(fullDoc!.location).toBe('Ho Chi Minh City, Vietnam');
    });

    it('Signal 2a with empty payload fails gracefully — doc stays PARTIAL_PARSED', async () => {
      const jobLifecycleId = 'c1-dm-2a-empty';
      const partialDoc = {
        _id: jobLifecycleId,
        raw: '<html><body>partial</body></html>',
        stage: JobStage.PARTIAL_PARSED,
        status: JobStatus.ENRICHING,
        source: JobSource.BROWSER_AUTO,
        company: 'FailCorp',
        role: 'Backend Developer',
        createdAt: new Date(),
        updatedAt: new Date(),
        stageTimestamp: new Date(),
      };
      await tc.mongoJobLifecycleAdapter.upsert(partialDoc as any);

      const fail = await tc.bus.setup([ActionEvent.PARSE_FAILED]);
      await tc.ingestor.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, '', jobLifecycleId, undefined, new Date());
      const failMsg = await fail.msg();
      expect(failMsg.jobLifecycleId).toBe(jobLifecycleId);

      const doc = await tc.mongoJobLifecycleAdapter.findById(jobLifecycleId);
      expect(doc).not.toBeNull();
      expect(doc!.stage).toBe(JobStage.PARTIAL_PARSED);
    });
  });

  describe('fast-check saga property invariants', () => {
    const ROLES = ['Software Engineer', 'Backend Developer', 'Full Stack Developer', 'Data Engineer'];

    it('property: random role/company pairs never crash the saga and converge to valid states', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ROLES),
          fc.string({ minLength: 1, maxLength: 20 }),
          fc.integer({ min: 0, max: 9 }),
          async (role, company, workerIdx) => {
            const safeCompany = company.replace(/[<>&]/g, '') || 'Co';
            await tc.ingestor.processIngest(
              JobSource.BROWSER_AUTO,
              JobStage.PARTIAL_PARSED,
              topcvEmailHtmlMany([{ role, company: `${safeCompany}${workerIdx}` }]),
              undefined,
              { messageId: `c1-prop-${workerIdx}-${role.replace(/\s+/g, '')}` },
            );
            const doc = await tc.mongoJobLifecycleAdapter.findById(`c1-prop-${workerIdx}-${role.replace(/\s+/g, '')}-job-0`);
            if (doc) {
              expect([JobStatus.ENRICHING, JobStatus.ENRICHED]).toContain(doc.status);
            }
            return true;
          },
        ),
        { numRuns: 30 },
      );
    });

    it('property: repeated identical S1 ingests are idempotent (dedupe on role+company)', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...ROLES),
          async (role) => {
            const company = `C1DedupePropCo-${Math.random().toString(36).slice(2, 8)}`;
            const messageId = `c1-prop-dedupe-${Math.random().toString(36).slice(2, 8)}`;
            await tc.ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role, company }]), undefined, { messageId });
            await tc.ingestor.processIngest(JobSource.BROWSER_AUTO, JobStage.PARTIAL_PARSED, topcvEmailHtmlMany([{ role, company }]), undefined, { messageId });
            const docs = await tc.db.collection('job_lifecycle').find({ role, company }).toArray();
            expect(docs.length).toBeLessThanOrEqual(1);
            return true;
          },
        ),
        { numRuns: 15 },
      );
    });
  });
});
