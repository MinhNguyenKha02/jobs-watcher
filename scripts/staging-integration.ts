#!/usr/bin/env node

/**
 * Staging Integration Test
 * 
 * Tests end-to-end flow with REAL Gmail API (authenticated):
 * 1. Authenticate with real Gmail account
 * 2. Fetch a test email from the Job Alerts label
 * 3. Pass it through parser with validation
 * 4. Generate documents with validation
 * 5. Report results with detailed error tracking
 * 
 * Usage: 
 *   npm run staging:test
 * 
 * Requires: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, token.json (from 'npm run auth')
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GmailService } from '../src/services/gmail.js';
import { EmailParser } from '../src/services/parser.js';
import { DocumentGenerator } from '../src/services/generator.js';
import { config } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface StagingReport {
  timestamp: string;
  steps: {
    authentication: { success: boolean; message: string };
    labelFetch: { success: boolean; message: string; labelId?: string };
    messageFetch: { success: boolean; message: string; messageId?: string };
    parsing: { success: boolean; message: string; errors?: string[] };
    generation: { success: boolean; message: string; errors?: string[] };
  };
  overallSuccess: boolean;
  duration: number;
}

async function runStagingTest() {
  const startTime = Date.now();
  const report: StagingReport = {
    timestamp: new Date().toISOString(),
    steps: {
      authentication: { success: false, message: '' },
      labelFetch: { success: false, message: '' },
      messageFetch: { success: false, message: '' },
      parsing: { success: false, message: '', errors: [] },
      generation: { success: false, message: '', errors: [] },
    },
    overallSuccess: false,
    duration: 0,
  };

  try {
    console.log('🚀 Starting Staging Integration Test\n');

    // Step 1: Authentication
    console.log('📝 Step 1: Authenticating with Gmail API...');
    const gmailService = new GmailService();
    await gmailService.authenticate();
    report.steps.authentication.success = true;
    report.steps.authentication.message = 'Authentication successful';
    console.log('✅ Authentication successful\n');

    // Step 2: Fetch Job Alerts label
    console.log('📝 Step 2: Fetching Job Alerts label...');
    const labelId = await gmailService.getLabelId(config.gmail.labelName);
    if (!labelId) {
      throw new Error(`Label "${config.gmail.labelName}" not found`);
    }
    report.steps.labelFetch.success = true;
    report.steps.labelFetch.labelId = labelId;
    report.steps.labelFetch.message = `Found label: ${labelId}`;
    console.log(`✅ Found label: ${labelId}\n`);

    // Step 3: Fetch a test message
    console.log('📝 Step 3: Fetching test message from Job Alerts...');
    console.log(`   ℹ️  Label ID: ${labelId}`);
    
    const response = await gmailService.listMessagesByLabel(labelId, 1);
    console.log(`   ℹ️  API Response type: ${typeof response}`);
    console.log(`   ℹ️  Response is array: ${Array.isArray(response)}`);
    console.log(`   ℹ️  Response length: ${response?.length || 0}`);
    
    if (response && response.length > 0) {
      console.log(`   ℹ️  First message object:`, JSON.stringify(response[0], null, 2));
    }
    
    if (!response || response.length === 0) {
      throw new Error('No messages found in Job Alerts label');
    }
    
    const messageId = response[0].id || response[0];
    console.log(`   ℹ️  Extracted messageId: ${messageId}`);
    console.log(`   ℹ️  MessageId type: ${typeof messageId}`);
    
    if (!messageId || typeof messageId !== 'string') {
      throw new Error(`Invalid messageId: ${JSON.stringify(messageId)}`);
    }
    
    report.steps.messageFetch.success = true;
    report.steps.messageFetch.messageId = messageId;
    report.steps.messageFetch.message = `Fetched message: ${messageId}`;
    console.log(`✅ Fetched message: ${messageId}\n`);

    // Step 4: Get message details and parse
    console.log('📝 Step 4: Parsing email content...');
    const message = await gmailService.getMessage(messageId);
    const subject = gmailService.extractHeader(message, 'Subject') || '(No Subject)';
    const from = gmailService.extractHeader(message, 'From') || '(No From)';
    const body = gmailService.extractBody(message);

    const parser = new EmailParser();
    const parseResult = parser.parseWithValidation({
      emailId: messageId,
      subject,
      from,
      body,
      receivedAt: new Date(),
    });

    if (!parseResult.success) {
      report.steps.parsing.errors = parseResult.errors;
      report.steps.parsing.message = `Parsing completed with ${parseResult.errors.length} warning(s)`;
      console.log(`⚠️  ${report.steps.parsing.message}`);
      parseResult.errors.forEach(e => console.log(`   - ${e}`));
    } else {
      report.steps.parsing.success = true;
      report.steps.parsing.message = 'Parsing successful';
      console.log('✅ Parsing successful');
    }

    if (!parseResult.data) {
      throw new Error('Failed to parse email');
    }
    const parsed = parseResult.data;
    console.log(`   Platform: ${parsed.platform}`);
    console.log(`   Company: ${parsed.company}`);
    console.log(`   Position: ${parsed.position}`);
    console.log(`   Location: ${parsed.location || '(Not found)'}\n`);

    // Step 5: Generate documents
    console.log('📝 Step 5: Generating documents...');
    const generator = new DocumentGenerator();
    const genResult = await generator.generateForJobWithValidation({
      id: messageId,
      emailId: messageId,
      subject: parsed.subject,
      from: parsed.from,
      platform: parsed.platform,
      company: parsed.company,
      position: parsed.position,
      location: parsed.location,
      url: parsed.url,
      description: parsed.description,
      rawContent: parsed.rawContent,
      createdAt: new Date(),
      actions: [],
    });

    if (!genResult.success) {
      report.steps.generation.errors = genResult.errors;
      report.steps.generation.message = `Generation completed with ${genResult.errors.length} error(s)`;
      console.log(`⚠️  ${report.steps.generation.message}`);
      genResult.errors.forEach(e => console.log(`   - ${e}`));
    } else {
      report.steps.generation.success = true;
      report.steps.generation.message = 'Generation successful';
      console.log('✅ Generation successful');
    }
    console.log(`   Output: ${genResult.outputDir}`);
    genResult.generatedFiles.forEach(f => console.log(`   ✓ ${path.basename(f)}`));
    console.log();

    // Calculate overall success
    report.overallSuccess =
      report.steps.authentication.success &&
      report.steps.labelFetch.success &&
      report.steps.messageFetch.success &&
      report.steps.parsing.success &&
      report.steps.generation.success;

    report.duration = Date.now() - startTime;

    // Print summary
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 STAGING TEST SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Status: ${report.overallSuccess ? '✅ PASSED' : '⚠️  PARTIAL / FAILED'}`);
    console.log(`Duration: ${report.duration}ms`);
    console.log(`Timestamp: ${report.timestamp}\n`);

    console.log('Step Results:');
    Object.entries(report.steps).forEach(([step, result]) => {
      const icon = result.success ? '✅' : '⚠️ ';
      console.log(`  ${icon} ${step}: ${result.message}`);
    });
    console.log();

    // Save report
    const reportPath = path.join(process.cwd(), 'test-output', 'staging-report.json');
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`💾 Report saved to: ${reportPath}`);

    process.exit(report.overallSuccess ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Fatal Error:', err instanceof Error ? err.message : err);
    report.duration = Date.now() - startTime;

    const reportPath = path.join(process.cwd(), 'test-output', 'staging-report.json');
    const reportDir = path.dirname(reportPath);
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    process.exit(1);
  }
}

runStagingTest();
