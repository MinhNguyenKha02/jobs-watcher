import { describe, it, expect } from 'vitest';

import {
  matchBlockedContents,
  AntiBotBlockedError,
} from '../../../../src/domain/services/blocked-page-guard.js';

// F1: hard edge block shape — Indeed/Cloudflare denial page, no job body (job-0 `details` shape).
const BLOCK_HTML = `<html><head><title>Access Denied</title></head><body>
<h1>Access Denied</h1><p>Your request has been blocked.</p>
<p>You have been blocked. If you believe this in error, please go to support.indeed.com.</p>
<p>Your Ray ID for this request is a3b700880969a0e9</p>
</body></html>`;

// F2: soft-challenged page shape — challenge telemetry bootstrap + genuine job body (job-0 `raw` shape).
const TELEMETRY_WITH_BODY_HTML = `<html><head><script>var cfg={"challenge-loaded":true,
"captcha":{"jsv-ping":true,"first-interaction":true}};</script></head><body>
<h1>Full Stack Developer</h1><p>We are hiring a full stack developer with React and Node.js.</p>
</body></html>`;

describe('matchBlockedContents', () => {
  it('GIVEN hard block page WHEN matchBlockedContents evaluates THEN returns normalized denial marker', () => {
    expect(matchBlockedContents(BLOCK_HTML)).toBe('access_denied');
  });

  it('GIVEN header-less WAF block page WHEN matchBlockedContents evaluates THEN returns normalized marker', () => {
    const headerless403 =
      '<html><head><title>Attention Required</title></head><body><h1>Attention Required</h1></body></html>';
    expect(matchBlockedContents(headerless403)).toBe('attention_required');
  });

  it('GIVEN challenge telemetry with genuine body WHEN matchBlockedContents evaluates THEN returns null', () => {
    expect(matchBlockedContents(TELEMETRY_WITH_BODY_HTML)).toBeNull();
  });

  it('GIVEN genuine job page WHEN matchBlockedContents evaluates THEN returns null', () => {
    expect(
      matchBlockedContents('<html><body><h1>Backend Engineer</h1><p>Apply now.</p></body></html>')
    ).toBeNull();
  });

  it('GIVEN empty input WHEN matchBlockedContents evaluates THEN returns null', () => {
    expect(matchBlockedContents('')).toBeNull();
    expect(matchBlockedContents('   ')).toBeNull();
  });

  it('GIVEN Ray ID variant WHEN matchBlockedContents evaluates THEN normalizes spacing to underscores', () => {
    expect(matchBlockedContents('<p>Your Ray ID for this request is abc123</p>')).toBe(
      'ray_id_for_this_request'
    );
  });

  it('GIVEN blocked url and marker WHEN AntiBotBlockedError constructs THEN carries url, marker and name', () => {
    const err = new AntiBotBlockedError('https://vn.indeed.com/rc/clk/dl?jk=abc', 'access_denied');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AntiBotBlockedError');
    expect(err.url).toContain('jk=abc');
    expect(err.marker).toBe('access_denied');
    expect(err.message).toContain('access_denied');
  });

  it('GIVEN no marker WHEN AntiBotBlockedError constructs THEN marker defaults to unknown', () => {
    expect(new AntiBotBlockedError('https://example.com').marker).toBe('unknown');
  });
});
