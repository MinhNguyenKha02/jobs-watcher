#!/usr/bin/env node

/**
 * STAGING & VALIDATION GUIDE
 * 
 * This guide explains the staging environment setup to test the jobs-watcher
 * with real Gmail API data before deploying with live Pub/Sub push notifications.
 */

// ============================================================================
// 1. OVERVIEW: Test Flow
// ============================================================================

/*
  
  UNIT TESTS (Mocked)
  ├─ Parser validation with fixture emails
  ├─ Generator validation with fixture jobs
  └─ Smart generator and notifications
  
  INTEGRATION TESTS (Mocked Gmail API)
  ├─ Gmail service methods (listMessages, getMessage, etc.)
  └─ Event webhook with mocked Gmail messages
  
  STAGING TEST (Real Gmail API)
  ├─ Authenticate with real Gmail account
  ├─ Fetch actual message from Job Alerts label
  ├─ Parse with real email content
  ├─ Generate documents
  └─ Report detailed validation results

  PRODUCTION (Real Pub/Sub Push)
  ├─ Gmail sends notification to Pub/Sub topic
  ├─ Pub/Sub pushes to webhook
  ├─ Webhook handles real Gmail data
  └─ Parser and generator process real emails

*/

// ============================================================================
// 2. QUICK START: Running Tests
// ============================================================================

/*

A. Run all mocked tests (no auth required):
   
   npm test
   
   Expected: 42 tests pass, ~72% coverage

B. Run specific test suites:
   
   npm run test:unit          # Parser, Generator, SmartGenerator unit tests
   npm run test:integration   # Gmail API integration tests (mocked)
   npm run test:e2e           # Webhook flow (mocked)

C. Run staging test with REAL Gmail API:
   
   npm run staging:test
   
   Prerequisites:
   - npm run auth              # Generate token.json via OAuth
   - resources/profile.json    # Create your profile
   - GMAIL_LABEL_NAME set in .env
   
   Output: test-output/staging-report.json with detailed results

*/

// ============================================================================
// 3. PARSER IMPROVEMENTS
// ============================================================================

/*

New Methods:
- parseWithValidation(input): ParserResult
  Returns: { success: boolean, data?: ParsedEmail, errors: string[] }
  
  Validates:
  ✓ Required fields (emailId, from, subject, body, receivedAt)
  ✓ Platform detection
  ✓ Company extraction
  ✓ Position extraction
  ✓ Description extraction
  
  Returns detailed error array for debugging real email issues

Legacy:
- parse(input): ParsedEmail | null
  Still works for backward compatibility

Example:
  const result = parser.parseWithValidation(emailInput);
  if (!result.success) {
    console.error('Validation errors:', result.errors);
  }
  const parsed = result.data;

*/

// ============================================================================
// 4. GENERATOR IMPROVEMENTS
// ============================================================================

/*

New Methods:
- generateForJobWithValidation(job): Promise<GeneratorResult>
  Returns: { success: boolean, outputDir?, errors: string[], generatedFiles: string[] }
  
  Validates:
  ✓ Job ID
  ✓ Company name (rejects "Unknown Company")
  ✓ Position title (rejects "Unknown Position")
  ✓ Template existence
  ✓ Handlebars compilation
  ✓ File write operations
  
  Returns detailed per-template error reports

Legacy:
- generateForJob(job): Promise<void>
  Still works for backward compatibility

Example:
  const result = await generator.generateForJobWithValidation(job);
  console.log('Generated files:', result.generatedFiles);
  if (result.errors.length > 0) {
    console.warn('Warnings:', result.errors);
  }

*/

// ============================================================================
// 5. STAGING SCRIPT
// ============================================================================

/*

File: scripts/staging-integration.ts

Steps:
1. Authenticate with Gmail API using token.json
2. Fetch Job Alerts label ID
3. List and fetch first message from that label
4. Extract message details (subject, from, body)
5. Parse with validation (detailed error tracking)
6. Generate documents with validation (per-template errors)
7. Report summary (success/partial/failed)
8. Save JSON report to test-output/staging-report.json

Report Structure:
{
  timestamp: ISO8601,
  steps: {
    authentication: { success, message },
    labelFetch: { success, message, labelId? },
    messageFetch: { success, message, messageId? },
    parsing: { success, message, errors? },
    generation: { success, message, errors? }
  },
  overallSuccess: boolean,
  duration: ms
}

Usage:
  npm run staging:test

Requires:
  - .env with GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_LABEL_NAME
  - token.json from 'npm run auth'
  - resources/profile.json with your details
  - Job Alerts label with at least 1 test email

*/

// ============================================================================
// 6. DATA VALIDATION FLOW
// ============================================================================

/*

Email → Parser → Generator
  ↓       ↓        ↓
Input   Extract   Validate
(raw)   & Check   Job Data
        Errors    Template
               ↓
            Output
            Files

Each stage collects errors:
- Parser: Missing company, position, description, platform issues
- Generator: Missing profiles, templates, invalid job data

*/

// ============================================================================
// 7. BEFORE DEPLOYING TO PRODUCTION
// ============================================================================

/*

Checklist:
□ npm test                    # All 42 tests pass
□ npm run validate             # Config validation passes
□ npm run staging:test        # Staging test passes with real Gmail
□ Check test-output/staging-report.json for any warnings
□ Review parser errors in report (company/position extraction)
□ Review generator errors in report (template issues)
□ Ensure resources/profile.json has all required fields
□ Test with 2-3 real job emails from different platforms
□ npm run pubsub:subscribe    # Create Pub/Sub subscription
□ npm start                   # Start webhook server

Then:
- Gmail will push real messages to Pub/Sub topic
- Pub/Sub pushes to webhook (/webhook/gmail)
- Webhook calls parser with real email data
- Parser validates and extracts fields
- Generator creates documents
- Actions executed (popup, notifications, queue)

*/

// ============================================================================
// 8. TROUBLESHOOTING
// ============================================================================

/*

Issue: Parser returns "Unknown Company"
→ Check email body for company name patterns
→ Add custom regex pattern for your platforms
→ Use parseWithValidation to see specific errors

Issue: Generator fails with template error
→ Check templates/ directory has all required files (cv.tex, resume.tex, cover-letter.md)
→ Verify Handlebars syntax in templates ({{variable}} format)
→ Check profile.json has all expected fields
→ Use generateForJobWithValidation to see per-template errors

Issue: Staging test fails to authenticate
→ Run: npm run auth
→ Verify token.json exists
→ Check Gmail API is enabled in Google Cloud console

Issue: No messages in Job Alerts label
→ Check GMAIL_LABEL_NAME in .env matches actual label name
→ Create a test email manually or send one from job platform

*/

// ============================================================================
// 9. NEXT STEPS
// ============================================================================

/*

✓ Unit tests with validation (done)
✓ Integration tests with mocked APIs (done)
✓ Staging script with real Gmail API (done)
✓ Enhanced error reporting (done)

→ Run staging test with real email
→ Review reports and fix any parser/generator issues
→ Deploy Pub/Sub subscription
→ Start webhook server
→ Monitor real job email processing

*/
