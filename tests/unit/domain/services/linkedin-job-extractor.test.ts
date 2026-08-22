import { describe, it, expect } from 'vitest';

import { LinkedInJobExtractor } from '../../../../src/domain/services/extractor/linkedin-job-extractor.js';
import { linkedinSduiDetailHtml } from '../../../../tests/helpers/html-fixtures.js';
import {
  linkedinDetailFixture,
  linkedinDetailEasyApplyFixture,
} from '../../../__fixtures__/html-fixture-loader.js';

interface LinkedInJobExpectation {
  role: string;
  company: string;
  location: string;
  deadline: string;
  easyApply: boolean;
  jobType: string;
  workLocationType: string;
}

function makeExtractor(): LinkedInJobExtractor {
  return new LinkedInJobExtractor();
}

function makeExpectedAxonJob(): LinkedInJobExpectation {
  return {
    role: 'Backend Software Engineer',
    company: 'Axon',
    location: 'Ho Chi Minh City, Ho Chi Minh City, Vietnam',
    deadline: 'Reposted 1 week ago',
    easyApply: false,
    jobType: 'Full-time',
    workLocationType: 'On-site',
  };
}

function makeExpectedManulifeJob(): LinkedInJobExpectation {
  return {
    role: 'Front End Software Engineer',
    company: 'Manulife',
    location: 'Tân Bình, Ho Chi Minh City, Vietnam',
    deadline: '1 month ago',
    easyApply: true,
    jobType: 'Full-time',
    workLocationType: 'Hybrid',
  };
}

describe('LinkedInJobExtractor', () => {
  let extractor: LinkedInJobExtractor;

  beforeEach(() => {
    extractor = makeExtractor();
  });

  describe('extract — metadata (root fields)', () => {
    it('GIVEN LinkedIn SDUi detail html (Axon) WHEN extract evaluates THEN extracts role/company/location/deadline', () => {
      const result = extractor.extract(linkedinDetailFixture());
      const expected = makeExpectedAxonJob();

      expect(result?.role).toBe(expected.role);
      expect(result?.company).toBe(expected.company);
      expect(result?.location).toBe(expected.location);
      expect(result?.deadline).toBe(expected.deadline);
    });

    it('GIVEN LinkedIn SDUi detail html with Easy Apply (Manulife) WHEN extract evaluates THEN extracts role/company/location/deadline', () => {
      const result = extractor.extract(linkedinDetailEasyApplyFixture());
      const expected = makeExpectedManulifeJob();

      expect(result?.role).toBe(expected.role);
      expect(result?.company).toBe(expected.company);
      expect(result?.location).toBe(expected.location);
      expect(result?.deadline).toBe(expected.deadline);
    });

    it('GIVEN both SDUi fixtures WHEN extract evaluates THEN extracts url pointing to linkedin jobs/view', () => {
      for (const fixture of [linkedinDetailFixture(), linkedinDetailEasyApplyFixture()]) {
        const result = extractor.extract(fixture);
        expect(result?.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);
      }
    });

    it.each([
      ['regular (external apply)', linkedinDetailFixture(), false],
      ['easy-apply', linkedinDetailEasyApplyFixture(), true],
    ])('GIVEN %s fixture WHEN extract evaluates THEN detects easyApply=%s', (_name, html, expected) => {
      const result = extractor.extract(html);
      expect(result?.easyApply).toBe(expected);
    });

    it('GIVEN both SDUi fixtures WHEN extract evaluates THEN extracts jobType and workLocationType tags', () => {
      const axon = extractor.extract(linkedinDetailFixture());
      expect(axon?.jobType).toBe(makeExpectedAxonJob().jobType);
      expect(axon?.workLocationType).toBe(makeExpectedAxonJob().workLocationType);

      const manulife = extractor.extract(linkedinDetailEasyApplyFixture());
      expect(manulife?.jobType).toBe(makeExpectedManulifeJob().jobType);
      expect(manulife?.workLocationType).toBe(makeExpectedManulifeJob().workLocationType);
    });

    it('GIVEN both SDUi fixtures without salary section WHEN extract evaluates THEN salary is undefined', () => {
      expect(extractor.extract(linkedinDetailFixture())?.salary).toBeUndefined();
      expect(extractor.extract(linkedinDetailEasyApplyFixture())?.salary).toBeUndefined();
    });

    it('GIVEN both SDUi fixtures WHEN extract evaluates THEN description stays empty (details replaces it)', () => {
      expect(extractor.extract(linkedinDetailFixture())?.description).toBeUndefined();
      expect(extractor.extract(linkedinDetailEasyApplyFixture())?.description).toBeUndefined();
    });
  });

  describe('extract — details (htmlToText after metadata truncation)', () => {
    it('GIVEN LinkedIn SDUi detail html WHEN extract evaluates THEN details is non-empty plain text', () => {
      const result = extractor.extract(linkedinDetailFixture());

      expect(typeof result?.details).toBe('string');
      expect(result?.details?.length).toBeGreaterThan(0);
      expect(result?.details).not.toMatch(/<[^>]+>/);
    });

    it('GIVEN LinkedIn SDUi detail html WHEN extract evaluates THEN details excludes root metadata fields', () => {
      const expected = makeExpectedAxonJob();
      const result = extractor.extract(linkedinDetailFixture());

      expect(result?.details).not.toContain(expected.deadline);
      expect(result?.details).not.toContain(expected.location);
      expect(result?.details).toContain('About the job');
    });

    it('GIVEN easy-apply fixture WHEN extract evaluates THEN details contains about-the-job body text', () => {
      const result = extractor.extract(linkedinDetailEasyApplyFixture());

      expect(result?.details?.length).toBeGreaterThan(0);
      expect(result?.details).toContain('About the job');
    });
  });

  describe('extract — builder parity (helpers linkedinSduiDetailHtml vs captures)', () => {
    it.each([
      ['regular', { easyApply: false }, false],
      ['easy-apply', { easyApply: true }, true],
    ])(
      'GIVEN corrected builder %s variant WHEN extract evaluates THEN child1 fields match parameters and details is loose text',
      (_name, opts, expectedEasyApply) => {
        const html = linkedinSduiDetailHtml(
          'Backend Engineer',
          'Parity Co',
          'Đà Nẵng, Vietnam',
          'Build TypeScript services.',
          opts
        );
        const result = extractor.extract(html);

        expect(result?.role).toBe('Backend Engineer');
        expect(result?.company).toBe('Parity Co');
        expect(result?.location).toContain('Đà Nẵng');
        expect(result?.deadline).toMatch(/2 weeks ago/);
        expect(result?.easyApply).toBe(expectedEasyApply);
        expect(result?.jobType).toBe('Full-time');
        expect(result?.workLocationType).toBe('On-site');
        expect(result?.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);
        expect(typeof result?.details).toBe('string');
        expect(result?.details?.length).toBeGreaterThan(0);
      }
    );
  });

  describe('extract — rejection guards', () => {
    it('GIVEN html without jobs/view link WHEN extract evaluates THEN returns null', () => {
      expect(extractor.extract('<html><body><p>Not a job page</p></body></html>')).toBeNull();
    });

    it('GIVEN empty string WHEN extract evaluates THEN returns null', () => {
      expect(extractor.extract('')).toBeNull();
    });
  });
});
