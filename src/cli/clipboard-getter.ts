/**
 * Clipboard getter/setter for fixture-driven E2E/integration tests
 */
import { indeedPlatformPageHtml1, indeedPlatformPageHtml2, linkedinPlatformPageHtml1, linkedinPlatformPageHtml2 } from '../../tests/__fixtures__/emails.js';

// Simulate clipboard setter: injects a fixture job by name
export function clipboardSetter(fixtureName: string) {
  const fixtures: Record<string, string> = {
    indeed1: indeedPlatformPageHtml1,
    indeed2: indeedPlatformPageHtml2,
    linkedin1: linkedinPlatformPageHtml1,
    linkedin2: linkedinPlatformPageHtml2,
  };
  if (!(fixtureName in fixtures)) throw new Error(`Unknown fixture: ${fixtureName}`);
  (global as any).__clipboardJob = fixtures[fixtureName];
}

// Clipboard getter: returns all fixture jobs (for batch test), or the last set job
export async function clipboardGetter(): Promise<any[]> {
  if ((global as any).__clipboardJob) return [(global as any).__clipboardJob];
  // Default: return all for batch
  return [
    indeedPlatformPageHtml1,
    indeedPlatformPageHtml2,
    linkedinPlatformPageHtml1,
    linkedinPlatformPageHtml2,
  ];
}
// (Removed duplicate clipboardy import and clipboardGetter implementation)
