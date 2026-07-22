import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const OLD_ENV = { ...process.env };

async function getLoadConfig() {
  const mod = await import('../../src/config.js');
  return mod.loadConfig;
}

describe('Config loading', () => {
  let loadConfig: Awaited<ReturnType<typeof getLoadConfig>>;

  beforeAll(async () => {
    loadConfig = await getLoadConfig();
  });

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'test';
    process.env.GMAIL_CLIENT_ID = 'test-client-id';
    process.env.GMAIL_CLIENT_SECRET = 'test-client-secret';
    process.env.GMAIL_REDIRECT_URI = 'http://localhost:3000/oauth2callback';
    process.env.GMAIL_TOPIC_NAME = 'projects/test-project/topics/test-topic';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  it('returns defaults when minimal env vars are set', () => {
    const cfg = loadConfig();
    expect(cfg.nodeEnv).toBe('test');
    expect(cfg.isTest).toBe(true);
    expect(cfg.isDev).toBe(false);
    expect(cfg.isProd).toBe(false);
    expect(cfg.webhook.port).toBe(3000);
    expect(cfg.webhook.path).toBe('/webhook/gmail');
    expect(cfg.gmail.labelName).toBe('Job Alerts');
    expect(cfg.browser.headless).toBe(true);
    expect(cfg.browser.timeout).toBe(30000);
    expect(cfg.features.notifications).toBe(true);
    expect(cfg.features.tui).toBe(true);
    expect(cfg.features.logging).toBe(true);
    expect(cfg.mode).toBe('data-listening');
    expect(cfg.sse.eventBufferMax).toBe(2000);
    expect(cfg.sse.replayLimit).toBe(200);
  });

  it('reads MONGODB_URI from env', () => {
    const cfg = loadConfig();
    expect(cfg.mongodb.uri).toBe('mongodb://localhost:27017/test');
  });

  it('reads MONGODB_DB_NAME from env', () => {
    process.env.MONGODB_DB_NAME = 'custom-db';
    const cfg = loadConfig();
    expect(cfg.mongodb.dbName).toBe('custom-db');
  });

  it('reads WEBHOOK_PORT from env', () => {
    process.env.WEBHOOK_PORT = '4000';
    const cfg = loadConfig();
    expect(cfg.webhook.port).toBe(4000);
  });

  it('reads BROWSER_HEADLESS=false as false', () => {
    process.env.BROWSER_HEADLESS = 'false';
    const cfg = loadConfig();
    expect(cfg.browser.headless).toBe(false);
  });

  it('reads BROWSER_TIMEOUT from env', () => {
    process.env.BROWSER_TIMEOUT = '15000';
    const cfg = loadConfig();
    expect(cfg.browser.timeout).toBe(15000);
  });

  it('reads SSE_EVENT_BUFFER_MAX with fallback to 2000', () => {
    delete process.env.SSE_EVENT_BUFFER_MAX;
    const cfg = loadConfig();
    expect(cfg.sse.eventBufferMax).toBe(2000);
  });

  it('reads SSE_REPLAY_LIMIT with fallback to 200', () => {
    delete process.env.SSE_REPLAY_LIMIT;
    const cfg = loadConfig();
    expect(cfg.sse.replayLimit).toBe(200);
  });

  it('reads OPERATIONAL_MODE for mode', () => {
    process.env.OPERATIONAL_MODE = 'data-testing';
    const cfg = loadConfig();
    expect(cfg.mode).toBe('data-testing');
  });

  it('reads FEATURE_NOTIFICATIONS=false', () => {
    process.env.FEATURE_NOTIFICATIONS = 'false';
    const cfg = loadConfig();
    expect(cfg.features.notifications).toBe(false);
  });

  it('reads FEATURE_TUI=false', () => {
    process.env.FEATURE_TUI = 'false';
    const cfg = loadConfig();
    expect(cfg.features.tui).toBe(false);
  });

  it('reads FEATURE_LOGGING=false', () => {
    process.env.FEATURE_LOGGING = 'false';
    const cfg = loadConfig();
    expect(cfg.features.logging).toBe(false);
  });

  it('reads DATA_SOURCE_TYPE from env', () => {
    process.env.DATA_SOURCE_TYPE = 'db';
    const cfg = loadConfig();
    expect(cfg.dataSource.type).toBe('db');
  });

  it('reads DATA_SOURCE_BATCH_SIZE from env', () => {
    process.env.DATA_SOURCE_BATCH_SIZE = '25';
    const cfg = loadConfig();
    expect(cfg.dataSource.batchSize).toBe(25);
  });

  it('fails when GMAIL_CLIENT_ID is missing', () => {
    delete process.env.GMAIL_CLIENT_ID;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    loadConfig();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('fails when GMAIL_CLIENT_SECRET is missing', () => {
    delete process.env.GMAIL_CLIENT_SECRET;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    loadConfig();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('uses isDev/isProd/isTest flags consistently', () => {
    process.env.NODE_ENV = 'production';
    const prodCfg = loadConfig();
    expect(prodCfg.isProd).toBe(true);
    expect(prodCfg.isDev).toBe(false);
    expect(prodCfg.isTest).toBe(false);

    process.env.NODE_ENV = 'development';
    const devCfg = loadConfig();
    expect(devCfg.isDev).toBe(true);
    expect(devCfg.isProd).toBe(false);
    expect(devCfg.isTest).toBe(false);
  });
});
