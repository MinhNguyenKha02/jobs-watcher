import { clipboardGetter, clipboardSetter } from '../../../src/presentation/tui/services/clipboard-getter.js' ;
import * as fixtures from '../../__fixtures__/emails.js';

describe('clipboard getter/setter service', () => {
  beforeEach(() => {
    process.env.CLIPBOARD_FIXTURE_MODE = '1';
    (global as any).__clipboardJob = undefined;
  });

  afterEach(() => {
    delete process.env.CLIPBOARD_FIXTURE_MODE;
    (global as any).__clipboardJob = undefined;
  });

  test('sets and gets TopCV detail HTML', async () => {
    await clipboardSetter(fixtures.topCVDetailPageHTML);
    const items = await clipboardGetter();
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toContain('Software Developer For Broadband Devices');
  });

  test('deduplicates repeated get by hash', async () => {
    await clipboardSetter(fixtures.indeedDetailPageHTML);
    const first = await clipboardGetter();
    expect(first.length).toBeGreaterThan(0);
    const second = await clipboardGetter();
    expect(second.length).toBe(0);
  });
});
