import { buildTuiActionLogEntry, getTerminalRouteForAction } from '../../src/cli/enhanced-tui.js';
import { buildLegacyActionLogEntry } from '../../src/cli/manual-enrichment-loop.js';
import { resolveManualEnrichmentPollMs } from '../../src/cli/manual-enrichment.js';

describe('TUI routing deterministic helpers', () => {
  it('maps enhanced TUI actions to terminal routes deterministically', () => {
    expect(getTerminalRouteForAction('manual_validate_to_queue')).toBe('job_queue');
    expect(getTerminalRouteForAction('manual_reject_to_trash')).toBe('job_trash');
  });

  it('builds enhanced TUI action log entries with expected route details', () => {
    const entry = buildTuiActionLogEntry('msg-1', 'manual_validate_to_queue', {
      route: 'job_queue',
      matchScore: 90,
    });

    expect(entry.messageId).toBe('msg-1');
    expect(entry.action).toBe('manual_validate_to_queue');
    expect(entry.source).toBe('enhanced_tui');
    expect(entry.details).toEqual({ route: 'job_queue', matchScore: 90 });
    expect(typeof entry.timestamp).toBe('string');
  });

  it('builds legacy loop action log entries with deterministic source and route details', () => {
    const entry = buildLegacyActionLogEntry('msg-legacy', 'manual_reject_to_trash', {
      route: 'job_trash',
      reason: 'operator_skipped_legacy',
    });

    expect(entry.messageId).toBe('msg-legacy');
    expect(entry.action).toBe('manual_reject_to_trash');
    expect(entry.source).toBe('legacy_manual_enrichment_loop');
    expect(entry.details).toEqual({ route: 'job_trash', reason: 'operator_skipped_legacy' });
  });

  it('resolves poll-ms value from argv with fallback', () => {
    expect(resolveManualEnrichmentPollMs(['node', 'manual-enrichment.ts', '--poll-ms=2500'])).toBe(
      2500
    );
    expect(resolveManualEnrichmentPollMs(['node', 'manual-enrichment.ts', '--poll-ms=abc'])).toBe(
      5000
    );
    expect(resolveManualEnrichmentPollMs(['node', 'manual-enrichment.ts'], 7000)).toBe(7000);
  });
});
