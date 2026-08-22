import { describe, it, expect } from 'vitest';

import {
  matchesRole,
  matchesLang,
  matchesExperience,
} from '../../../../src/domain/filter/constraints.js';

describe('matchesRole', () => {
  it('GIVEN matchesRole input "Software Engineer" WHEN matchesRole evaluates THEN matches software engineer', () => {
    expect(matchesRole('Software Engineer')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesRole input "Full-Stack Developer" WHEN matchesRole evaluates THEN matches full-stack developer', () => {
    expect(matchesRole('Full-Stack Developer')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesRole input "Backend Engineer" WHEN matchesRole evaluates THEN matches backend engineer', () => {
    expect(matchesRole('Backend Engineer')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesRole input "kỹ sư phần mềm" WHEN matchesRole evaluates THEN matches Vietnamese role patterns', () => {
    expect(matchesRole('kỹ sư phần mềm')).toEqual({ passed: true, reasons: [] });
    expect(matchesRole('lập trình viên full-stack')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesRole input "Marketing Manager" WHEN matchesRole evaluates THEN rejects non-software roles', () => {
    const result = matchesRole('Marketing Manager');
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['non-software role']);
  });

  it('GIVEN matchesRole input "null" WHEN matchesRole evaluates THEN rejects null input (reason: No role information)', () => {
    expect(matchesRole(null)).toEqual({ passed: false, reasons: ['No role information'] });
  });

  it('GIVEN matchesRole input "undefined" WHEN matchesRole evaluates THEN rejects undefined input (reason: No role information)', () => {
    expect(matchesRole(undefined)).toEqual({ passed: false, reasons: ['No role information'] });
  });

  it('GIVEN matchesRole WHEN matchesRole evaluates THEN rejects empty string (BVA boundary — treated as missing input) (reason: No role information)', () => {
    expect(matchesRole('')).toEqual({ passed: false, reasons: ['No role information'] });
  });

  it('GIVEN matchesRole input "X" WHEN matchesRole evaluates THEN rejects single-char non-software role (BVA boundary)', () => {
    expect(matchesRole('X')).toEqual({ passed: false, reasons: ['non-software role'] });
  });

  it('GIVEN input is string WHEN matchesRole evaluates THEN matches via description', () => {
    const result = matchesRole('Build software', 'Senior Software Developer');
    expect(result.passed).toBe(true);
  });
});

describe('matchesLang', () => {
  it('GIVEN matchesLang input "python developer" WHEN matchesLang evaluates THEN matches python', () => {
    expect(matchesLang('python developer')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesLang input "Typescript" WHEN matchesLang evaluates THEN matches typescript', () => {
    expect(matchesLang('Typescript')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesLang input "Golang experience" WHEN matchesLang evaluates THEN matches go', () => {
    expect(matchesLang('Golang experience')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesLang input "COBOL" WHEN matchesLang evaluates THEN rejects unknown languages', () => {
    const result = matchesLang('COBOL');
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['No matching language']);
  });

  it('GIVEN matchesLang input "null" WHEN matchesLang evaluates THEN rejects null input (reason: No language information)', () => {
    expect(matchesLang(null)).toEqual({ passed: false, reasons: ['No language information'] });
  });

  it('GIVEN matchesLang input "undefined" WHEN matchesLang evaluates THEN rejects undefined input (BVA boundary) (reason: No language information)', () => {
    expect(matchesLang(undefined)).toEqual({ passed: false, reasons: ['No language information'] });
  });

  it('GIVEN matchesLang WHEN matchesLang evaluates THEN rejects empty string (BVA boundary) (reason: No language information)', () => {
    expect(matchesLang('')).toEqual({ passed: false, reasons: ['No language information'] });
  });

  it('GIVEN matchesLang input "12345" WHEN matchesLang evaluates THEN rejects numeric string (BVA boundary) (reason: No matching language)', () => {
    expect(matchesLang('12345')).toEqual({ passed: false, reasons: ['No matching language'] });
  });
});

describe('matchesExperience', () => {
  it('GIVEN matchesExperience input "Senior Software Engineer" WHEN matchesExperience evaluates THEN rejects senior roles', () => {
    const result = matchesExperience('Senior Software Engineer');
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['Not matching experience level']);
  });

  it('GIVEN matchesExperience input "Tech Lead" WHEN matchesExperience evaluates THEN rejects lead roles (reason: Not matching experience level)', () => {
    expect(matchesExperience('Tech Lead')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it('GIVEN matchesExperience input "3+ years experience" WHEN matchesExperience evaluates THEN rejects 3+ years experience (reason: Not matching experience level)', () => {
    expect(matchesExperience('3+ years experience')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it('GIVEN matchesExperience input "3 to 5 years" WHEN matchesExperience evaluates THEN rejects seniority range (reason: Not matching experience level)', () => {
    expect(matchesExperience('3 to 5 years')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it('GIVEN matchesExperience input "kinh nghiem tu 3 nam" WHEN matchesExperience evaluates THEN rejects Vietnamese experience patterns (reason: Not matching experience level)', () => {
    expect(matchesExperience('kinh nghiem tu 3 nam')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it('GIVEN matchesExperience input "Junior Developer" WHEN matchesExperience evaluates THEN passes junior roles', () => {
    expect(matchesExperience('Junior Developer')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesExperience input "Entry level position" WHEN matchesExperience evaluates THEN passes entry level', () => {
    expect(matchesExperience('Entry level position')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesExperience WHEN matchesExperience evaluates THEN rejects empty input (reason: No experience information)', () => {
    expect(matchesExperience('')).toEqual({
      passed: false,
      reasons: ['No experience information'],
    });
  });

  it('GIVEN matchesExperience input "null" WHEN matchesExperience evaluates THEN rejects null input (BVA boundary) (reason: No experience information)', () => {
    expect(matchesExperience(null)).toEqual({
      passed: false,
      reasons: ['No experience information'],
    });
  });

  it('GIVEN matchesExperience input "undefined" WHEN matchesExperience evaluates THEN rejects undefined input (BVA boundary) (reason: No experience information)', () => {
    expect(matchesExperience(undefined)).toEqual({
      passed: false,
      reasons: ['No experience information'],
    });
  });

  it('GIVEN matchesExperience input "0 years experience" WHEN matchesExperience evaluates THEN passes 0 years experience (BVA — only 3+ is rejected)', () => {
    expect(matchesExperience('0 years experience')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesExperience input "1+ year of experience" WHEN matchesExperience evaluates THEN passes 1 year experience (BVA — only 3+ is rejected)', () => {
    expect(matchesExperience('1+ year of experience')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesExperience input "2 years experience required" WHEN matchesExperience evaluates THEN passes 2 years experience (BVA — only 3+ is rejected)', () => {
    expect(matchesExperience('2 years experience required')).toEqual({ passed: true, reasons: [] });
  });

  it('GIVEN matchesExperience input "3+ years experience" WHEN matchesExperience evaluates THEN rejects 3 years experience (BVA boundary at rejection threshold) (reason: Not matching experience level)', () => {
    expect(matchesExperience('3+ years experience')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it('GIVEN matchesExperience input "4 years of experience" WHEN matchesExperience evaluates THEN rejects 4 years experience (BVA boundary above threshold) (reason: Not matching experience level)', () => {
    expect(matchesExperience('4 years of experience')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it('GIVEN matchesExperience input "Senior Software Engineer" WHEN matchesExperience evaluates THEN rejects senior software engineer pattern (reason: Not matching experience level)', () => {
    expect(matchesExperience('Senior Software Engineer')).toEqual({
      passed: false,
      reasons: ['Not matching experience level'],
    });
  });

  it.each([
    ['2-3 years experience', '2-3 years experience'],
    ['2-4 years experience', '2-4 years experience'],
    ['2 to 4 years experience', '2 to 4 years experience'],
    ['3-5 years experience', '3-5 years experience'],
    ['3 to 5 years experience', '3 to 5 years experience'],
    ['4-6 years experience', '4-6 years experience'],
    ['5-7 years experience', '5-7 years experience'],
  ])(
    'GIVEN role/copy states %s WHEN matchesExperience evaluates THEN matchesExperience rejects with reason',
    (_label, input) => {
      const result = matchesExperience(input);
      expect(result.passed).toBe(false);
      expect(result.reasons).toEqual(['Not matching experience level']);
    }
  );

  it.each([
    ['10', '10 years experience'],
    ['10+', '10+ years experience'],
    ['99', '99 years experience'],
    ['7', '7 years experience'],
  ])(
    'GIVEN 2-digit experience %s years WHEN matchesExperience evaluates THEN matchesExperience rejects with reason',
    (_label, input) => {
      const result = matchesExperience(input);
      expect(result.passed).toBe(false);
      expect(result.reasons).toEqual(['Not matching experience level']);
    }
  );

  it('GIVEN 100 years experience (numeric carve-out, out of scope) WHEN matchesExperience evaluates THEN passes with no reasons', () => {
    expect(matchesExperience('100 years experience')).toEqual({ passed: true, reasons: [] });
  });
});
