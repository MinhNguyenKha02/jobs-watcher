import { isLegacyManualEnrichmentEnabled } from '../../src/cli/data-listening.js';

describe('data-listening legacy manual enrichment flags', () => {
  it('is disabled by default when no legacy flags are passed', () => {
    expect(isLegacyManualEnrichmentEnabled(['node', 'data-listening.ts', '--adapter=hybrid'])).toBe(
      false
    );
  });

  it('is enabled only when --manual-enrichment=legacy is passed', () => {
    expect(
      isLegacyManualEnrichmentEnabled([
        'node',
        'data-listening.ts',
        '--adapter=hybrid',
        '--manual-enrichment=legacy',
      ])
    ).toBe(true);
  });

  it('is enabled only when --legacy-manual-enrichment=true is passed', () => {
    expect(
      isLegacyManualEnrichmentEnabled([
        'node',
        'data-listening.ts',
        '--adapter=hybrid',
        '--legacy-manual-enrichment=true',
      ])
    ).toBe(true);
  });
});
