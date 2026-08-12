// Global test setup
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Ensure test directories exist
const testDirs = [path.join(__dirname, '../test-output'), path.join(__dirname, '../test-logs')];

beforeAll(() => {
  testDirs.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
});

// Clean up test output after all tests
afterAll(() => {
  testDirs.forEach((dir) => {
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

// Route shared TUI ipc-file traffic away from the real ~/.cache state so tests
// never collide with a live TUI process. Each vitest process gets a unique file.
process.env.TUI_SHARED_STATE_PATH = path.join(
  os.tmpdir(),
  `jobs-watcher-test-tui-state-${process.pid}.json`
);
