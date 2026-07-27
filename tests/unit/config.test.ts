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

  it('fails when GMAIL_CLIENT_ID is missing', () => {
    delete process.env.GMAIL_CLIENT_ID;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      loadConfig();
    } catch {
      // loadConfig may throw or call process.exit — both acceptable
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('fails when GMAIL_CLIENT_SECRET is missing', () => {
    delete process.env.GMAIL_CLIENT_SECRET;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      loadConfig();
    } catch {
      // loadConfig may throw or call process.exit — both acceptable
    }
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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
