/**
 * Centralized execution mode detection.
 * Decided at bootstrap (src/index.ts startup), immutable thereafter.
 * Eliminates scattered env var checks across codebase (HIGH violation).
 */

export type ExecutionMode = 'PRODUCTION' | 'TEST' | 'FIXTURE' | 'HEADLESS';

export interface ModeContext {
  readonly mode: ExecutionMode;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly isFixture: boolean;
  readonly isHeadless: boolean;
}

/**
 * Detect execution mode from environment variables.
 *
 * Priority order (first match wins):
 * 1. INGRESS_FIXTURE_MODE=1 → FIXTURE
 * 2. TEST_RUNNER=1 or NODE_ENV=test → TEST
 * 3. HEADLESS=1 → HEADLESS
 * 4. Default → PRODUCTION
 *
 * Violations fixed:
 * - ✓ Single source of truth (was: scattered env var checks)
 * - ✓ Decided at bootstrap (was: runtime checks in adapters)
 * - ✓ Mutually exclusive (was: TEST + NO_BACKGROUND_WORK confusion)
 */
export function detectExecutionMode(): ModeContext {
  const isFixture = process.env.INGRESS_FIXTURE_MODE === '1';
  const isTest = process.env.TEST_RUNNER === '1' || process.env.NODE_ENV === 'test';
  const isHeadless = process.env.HEADLESS === '1';

  let mode: ExecutionMode;

  if (isFixture) {
    mode = 'FIXTURE';
  } else if (isTest) {
    mode = 'TEST';
  } else if (isHeadless) {
    mode = 'HEADLESS';
  } else {
    mode = 'PRODUCTION';
  }

  const context: ModeContext = {
    mode,
    isProduction: mode === 'PRODUCTION',
    isTest: mode === 'TEST',
    isFixture: mode === 'FIXTURE',
    isHeadless: mode === 'HEADLESS',
  };

  // Log at bootstrap for audit trail
  console.log(`[BOOTSTRAP] Execution mode detected: ${mode}`, {
    INGRESS_FIXTURE_MODE: process.env.INGRESS_FIXTURE_MODE,
    TEST_RUNNER: process.env.TEST_RUNNER,
    NODE_ENV: process.env.NODE_ENV,
    HEADLESS: process.env.HEADLESS,
  });

  return context;
}

/**
 * Global singleton instance.
 * Set once at bootstrap in src/index.ts, used throughout app.
 */
let globalModeContext: ModeContext | null = null;

export function initializeModeContext(context: ModeContext): void {
  if (globalModeContext !== null) {
    throw new Error('[BOOTSTRAP] ModeContext already initialized. Cannot reinitialize.');
  }
  globalModeContext = context;
}

export function getModeContext(): ModeContext {
  if (globalModeContext === null) {
    throw new Error('[BOOTSTRAP] ModeContext not initialized. Call initializeModeContext() first.');
  }
  return globalModeContext;
}

/** @internal Reset singleton for test isolation */
export function _resetModeContext(): void {
  globalModeContext = null;
}
