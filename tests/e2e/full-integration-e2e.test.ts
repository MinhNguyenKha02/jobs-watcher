/**
 * Full Integration E2E Test (Phase 3C)
 * Runs the real job-to-application-to-send-to-metrics workflow using only real integrations.
 * Fails immediately and traceably if any required credential or integration is missing/invalid.
 * No simulation, no mocks, no fallback. All errors must be explicit and auditable.
 */

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import fs from 'fs';

import { MongoClient } from 'mongodb';

import { SmartGenerator } from '../../src/services/generators/smart-generator';
import { GmailService } from '../../src/services/gmail';

const MONGO_URI = `${process.env.MONGODB_URI}/${process.env.MONGODB_DB_NAME || ''}`;
const TEST_TO_EMAIL = '2051052080minh@ou.edu.vn';

describe('Full E2E Workflow (No Fallback, No Mock)', () => {
  let gmailService: GmailService;
  let mongo: MongoClient;

  beforeAll(async () => {
    // Check MongoDB
    if (!MONGO_URI) throw new Error('[E2E] Missing MONGO_URI (handler: beforeAll)');
    mongo = new MongoClient(MONGO_URI);
    await mongo.connect();
    // GmailService (Gmail API)
    gmailService = new GmailService();
    await gmailService.authenticate();
  });

  afterAll(async () => {
    await mongo.close();
  });

  it('runs the full job-to-application-to-send-to-metrics workflow', async () => {
    // 1. Load a sample job profile and job
    const jobProfilePath = path.join(__dirname, '../__fixtures__/sample-profile.json');
    const jobPath = path.join(__dirname, '../__fixtures__/sample-job.json');
    const jobProfile = JSON.parse(fs.readFileSync(jobProfilePath, 'utf-8'));
    const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));

    // 2. Generate application materials (CV, cover letter, resume)
    const generator = new SmartGenerator(jobProfile);
    const outputDir = await generator.generateForJob(job);
    expect(fs.existsSync(outputDir)).toBe(true);

    // 3. Send application via Gmail API (attach CV)
    const cvPath = path.join(outputDir, 'cv.tex');
    expect(fs.existsSync(cvPath)).toBe(true);
    const sendResult = await gmailService.sendMail({
      to: TEST_TO_EMAIL,
      subject: 'E2E Application Test',
      text: 'Automated E2E application test. See attached.',
      attachments: [{ filename: 'cv.tex', path: cvPath }],
    });
    if (!sendResult.success) {
      throw new Error(
        `[E2E] Email send failed: ${sendResult.error} (handler: gmailService.sendMail)`
      );
    }

    // 4. Record and verify metrics in MongoDB (regression enforcement)
    const db = mongo.db('jobs_watcher');
    const metrics = await db
      .collection('action_log')
      .find({ action: 'apply', email: TEST_TO_EMAIL })
      .toArray();
    if (!metrics.length || metrics.length === 0) {
      // This is a regression failure: enforce fixes: commit and explicit traceable error
      throw new Error(
        '[E2E] Regression: No metrics found for sent application (handler: metrics regression)'
      );
    }
    // If more analytics regression checks are needed, add them here with the same strict enforcement
    // All failures must be explicit, auditable, and fixed with a fixes: commit
  });
});
