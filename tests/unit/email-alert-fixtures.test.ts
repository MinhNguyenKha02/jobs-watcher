import { indeedEmailAlert, topCVEmailAlert } from '../__fixtures__/emails.js';

type Fixture = {
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    body?: { data?: string };
  };
};

const hasHeader = (fixture: Fixture, headerName: 'From' | 'Subject'): boolean =>
  Boolean(
    fixture.payload?.headers?.some(
      (h) => h?.name?.toLowerCase() === headerName.toLowerCase() && typeof h?.value === 'string' && h.value.trim().length > 0
    )
  );

const decodeBase64 = (data: string): string => Buffer.from(data, 'base64').toString('utf-8');

const assertGmailAlertFixture = (name: string, fixture: Fixture) => {
  expect(hasHeader(fixture, 'From')).toBe(true);
  expect(hasHeader(fixture, 'Subject')).toBe(true);

  const data = fixture.payload?.body?.data;
  expect(typeof data).toBe('string');
  expect(data?.length).toBeGreaterThan(0);

  const decoded = decodeBase64(data as string);
  expect(decoded.trim().length).toBeGreaterThan(0);
  expect(decoded).toMatch(/<html|<!doctype html|<body|<div|<p/i);

  // Keep assertion context clear in test output
  expect(name).toBeTruthy();
};

describe('Gmail alert fixtures contract', () => {
  it('validates topCVEmailAlert fixture shape and payload', () => {
    assertGmailAlertFixture('topCVEmailAlert', topCVEmailAlert);
  });

  it('validates indeedEmailAlert fixture shape and payload', () => {
    assertGmailAlertFixture('indeedEmailAlert', indeedEmailAlert);
  });
});
