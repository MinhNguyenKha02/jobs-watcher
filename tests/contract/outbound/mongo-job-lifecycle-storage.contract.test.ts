import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import type { JobLifecyclePort } from '../../../src/application/ports/job-lifecycle.port.js';
import { JobStage, JobSource, JobStatus } from '../../../src/domain/types/job-lifecycle.js';
import type { JobLifecycleDocument } from '../../../src/domain/types/job-lifecycle.js';
import {
  buildTestDaemonContainer,
  type TestDaemonContainer,
} from '../../helpers/test-container.js';
import { deleteTestExchange } from '../../helpers/test-utils.js';

const now = new Date();

function makeDoc(overrides: Partial<JobLifecycleDocument> & { _id: string }): JobLifecycleDocument {
  return {
    raw: overrides.raw || '<html>test</html>',
    stage: overrides.stage || JobStage.PARTIAL_PARSED,
    status: overrides.status || JobStatus.ENRICHING,
    source: overrides.source || JobSource.BROWSER_AUTO,
    company: overrides.company ?? '',
    role: overrides.role ?? '',
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    stageTimestamp: overrides.stageTimestamp || now,
    ...overrides,
    _id: overrides._id,
  };
}

describe('JobLifecyclePort — Mongo storage contract · contract mongo-job-lifecycle', () => {
  let daemon: TestDaemonContainer;
  let adapter: JobLifecyclePort;
  let collection: any;

  beforeAll(async () => {
    daemon = await buildTestDaemonContainer({ ns: 'app-ingestor-storage' });
    await daemon.start();
    adapter = daemon.jobLifecycle;
    collection = daemon.mongo.raw('job_lifecycle');
  }, 120000);

  afterAll(async () => {
    // Daemon-only suite (no TUI reader): self-delete the asserted test
    // exchange (finally => no cleanup script).
    try {
      await daemon.stop();
    } finally {
      await deleteTestExchange('jobs.events.int.app-ingestor-storage');
    }
  });

  it('GIVEN the Ingestor precondition WHEN upsert → findById on the real JobLifecyclePort THEN stores and retrieves a job lifecycle document (S1)', async () => {
    const doc = makeDoc({ _id: 'it-test-1', company: 'Acme Inc.', role: 'Senior Tester' });
    await adapter!.upsert(doc);

    const found = await adapter!.findById('it-test-1');
    expect(found).not.toBeNull();
    expect(found!.company).toBe('Acme Inc.');
    expect(found!.stage).toBe(JobStage.PARTIAL_PARSED);
  });

  it('GIVEN the Ingestor precondition WHEN upsert on the real JobLifecyclePort THEN upsert replaces the existing document (same _id) — prior payload is fully overwritten (S2+S1)', async () => {
    const doc1 = makeDoc({
      _id: 'it-upsert-1',
      company: 'UpsertCorp',
      role: 'Engineer',
      source: JobSource.MANUAL,
      stage: JobStage.PARTIAL_PARSED,
      raw: 'v1',
    });
    await adapter!.upsert(doc1);

    const doc2 = makeDoc({
      _id: 'it-upsert-1',
      company: 'UpsertCorp',
      role: 'Engineer',
      source: JobSource.MANUAL,
      stage: JobStage.FULL_PARSED,
      raw: 'v2',
    });
    await adapter!.upsert(doc2);

    const all = await collection.find({ _id: 'it-upsert-1' }).toArray();
    expect(all).toHaveLength(1);
    expect(all[0].raw).toBe('v2');
    expect(all[0].stage).toBe(JobStage.FULL_PARSED);
  });

  it('GIVEN the Ingestor precondition WHEN upsert → updateStage → findById on the real JobLifecyclePort THEN updates job status (S2+S3+S1)', async () => {
    const doc = makeDoc({
      _id: 'it-status-1',
      company: 'StatusCorp',
      role: 'Dev',
      stage: JobStage.FULL_PARSED,
      status: JobStatus.ENRICHING,
    });
    await adapter!.upsert(doc);

    await adapter!.updateStage('it-status-1', JobStage.FULL_PARSED, JobStatus.QUEUED);

    const updated = await adapter!.findById('it-status-1');
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe(JobStatus.QUEUED);
  });

  it('GIVEN the Ingestor precondition WHEN the port is exercised on the real JobLifecyclePort THEN creates required indexes on init', async () => {
    const indexes = await collection.indexes();
    const idIndex = indexes.find((i: any) => i.key?._id === 1);
    expect(idIndex).toBeDefined();
    const uniqueIndex = indexes.find((i: any) => i.name && i.name.startsWith('idx_role_company'));
    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex.unique).toBe(true);
  });
});
