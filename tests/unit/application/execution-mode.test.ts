import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const OLD_ENV = { ...process.env };

describe('Execution mode detection', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.INGRESS_FIXTURE_MODE;
    delete process.env.TEST_RUNNER;
    delete process.env.HEADLESS;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  async function getModules() {
    const mod = await import('../../../src/application/execution-mode.js');
    mod._resetModeContext();
    return {
      detectExecutionMode: mod.detectExecutionMode,
      initializeModeContext: mod.initializeModeContext,
      getModeContext: mod.getModeContext,
      _resetModeContext: mod._resetModeContext,
    };
  }

  it('detects PRODUCTION mode by default', async () => {
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('PRODUCTION');
    expect(ctx.isProduction).toBe(true);
    expect(ctx.isTest).toBe(false);
    expect(ctx.isFixture).toBe(false);
    expect(ctx.isHeadless).toBe(false);
  });

  it('detects TEST mode when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('TEST');
    expect(ctx.isTest).toBe(true);
    expect(ctx.isProduction).toBe(false);
  });

  it('detects TEST mode when TEST_RUNNER=1', async () => {
    process.env.TEST_RUNNER = '1';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('TEST');
    expect(ctx.isTest).toBe(true);
  });

  it('detects FIXTURE mode when INGRESS_FIXTURE_MODE=1', async () => {
    process.env.INGRESS_FIXTURE_MODE = '1';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('FIXTURE');
    expect(ctx.isFixture).toBe(true);
  });

  it('FIXTURE takes priority over TEST', async () => {
    process.env.INGRESS_FIXTURE_MODE = '1';
    process.env.TEST_RUNNER = '1';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('FIXTURE');
  });

  it('FIXTURE takes priority over HEADLESS', async () => {
    process.env.INGRESS_FIXTURE_MODE = '1';
    process.env.HEADLESS = '1';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('FIXTURE');
  });

  it('detects HEADLESS mode when HEADLESS=1', async () => {
    process.env.HEADLESS = '1';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('HEADLESS');
    expect(ctx.isHeadless).toBe(true);
    expect(ctx.isProduction).toBe(false);
  });

  it('HEADLESS does not override TEST', async () => {
    process.env.HEADLESS = '1';
    process.env.TEST_RUNNER = '1';
    const { detectExecutionMode } = await getModules();
    const ctx = detectExecutionMode();
    expect(ctx.mode).toBe('TEST');
  });

  it('initializeModeContext sets the global singleton', async () => {
    const { detectExecutionMode, initializeModeContext, getModeContext } = await getModules();
    const ctx = detectExecutionMode();
    initializeModeContext(ctx);
    const retrieved = getModeContext();
    expect(retrieved.mode).toBe(ctx.mode);
    expect(retrieved).toBe(ctx);
  });

  it('initializeModeContext throws on double init', async () => {
    const { detectExecutionMode, initializeModeContext } = await getModules();
    const ctx = detectExecutionMode();
    initializeModeContext(ctx);
    expect(() => initializeModeContext(ctx)).toThrow('already initialized');
  });

  it('getModeContext throws when not initialized', async () => {
    const { getModeContext } = await getModules();
    expect(() => getModeContext()).toThrow('not initialized');
  });

  it('isProduction/isTest/isFixture/isHeadless are mutually exclusive', async () => {
    const { detectExecutionMode } = await getModules();

    process.env.NODE_ENV = 'test';
    const testCtx = detectExecutionMode();
    const truthyCount = [
      testCtx.isProduction,
      testCtx.isTest,
      testCtx.isFixture,
      testCtx.isHeadless,
    ].filter(Boolean).length;
    expect(truthyCount).toBe(1);

    process.env.HEADLESS = '1';
    delete process.env.TEST_RUNNER;
    process.env.NODE_ENV = 'development';
    const headlessCtx = detectExecutionMode();
    const headlessTruthy = [
      headlessCtx.isProduction,
      headlessCtx.isTest,
      headlessCtx.isFixture,
      headlessCtx.isHeadless,
    ].filter(Boolean).length;
    expect(headlessTruthy).toBe(1);
  });
});
