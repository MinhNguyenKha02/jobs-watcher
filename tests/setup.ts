// Global test setup
import * as fs from 'fs';
import * as path from 'path';

// Ensure test directories exist
const testDirs = [
  path.join(__dirname, '../test-output'),
  path.join(__dirname, '../test-logs'),
];

beforeAll(() => {
  testDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

// Clean up test output after all tests
afterAll(() => {
  testDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Mock environment variables for tests
process.env.NODE_ENV = 'test';
process.env.GMAIL_CLIENT_ID = 'test-client-id';
process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
process.env.GMAIL_REDIRECT_URI = 'http://localhost:3000/oauth2callback';
process.env.GMAIL_TOPIC_NAME = 'projects/test-project/topics/test-topic';
