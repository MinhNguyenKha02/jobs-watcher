import { describe, it, expect } from 'vitest';
import { matchesRole, matchesLang, matchesExperience } from '../../../../src/domain/filter/constraints.js' ;

describe('matchesRole', () => {
  it('matches software engineer', () => {
    expect(matchesRole('Software Engineer')).toEqual({ passed: true, reasons: [] });
  });

  it('matches full-stack developer', () => {
    expect(matchesRole('Full-Stack Developer')).toEqual({ passed: true, reasons: [] });
  });

  it('matches backend engineer', () => {
    expect(matchesRole('Backend Engineer')).toEqual({ passed: true, reasons: [] });
  });

  it('matches Vietnamese role patterns', () => {
    expect(matchesRole('kỹ sư phần mềm')).toEqual({ passed: true, reasons: [] });
    expect(matchesRole('lập trình viên full-stack')).toEqual({ passed: true, reasons: [] });
  });

  it('rejects non-software roles', () => {
    const result = matchesRole('Marketing Manager');
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['non-software role']);
  });

  it('rejects null input', () => {
    expect(matchesRole(null)).toEqual({ passed: false, reasons: ['No role information'] });
  });

  it('rejects undefined input', () => {
    expect(matchesRole(undefined)).toEqual({ passed: false, reasons: ['No role information'] });
  });

  it('rejects empty string (BVA boundary — treated as missing input)', () => {
    expect(matchesRole('')).toEqual({ passed: false, reasons: ['No role information'] });
  });

  it('rejects single-char non-software role (BVA boundary)', () => {
    expect(matchesRole('X')).toEqual({ passed: false, reasons: ['non-software role'] });
  });


  it('matches via description when input is object', () => {
    const result = matchesRole({ responsibilities: 'Build software' }, 'Senior Software Developer');
    expect(result.passed).toBe(true);
  });
});

describe('matchesLang', () => {
  it('matches python', () => {
    expect(matchesLang('python developer')).toEqual({ passed: true, reasons: [] });
  });

  it('matches typescript', () => {
    expect(matchesLang('Typescript')).toEqual({ passed: true, reasons: [] });
  });

  it('matches go', () => {
    expect(matchesLang('Golang experience')).toEqual({ passed: true, reasons: [] });
  });

  it('rejects unknown languages', () => {
    const result = matchesLang('COBOL');
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['No matching language']);
  });

  it('rejects null input (no lang patterns in empty text)', () => {
    const result = matchesLang(null);
    expect(result.passed).toBe(false);
  });

  it('rejects undefined input (BVA boundary)', () => {
    const result = matchesLang(undefined);
    expect(result.passed).toBe(false);
  });

  it('rejects empty string (BVA boundary)', () => {
    const result = matchesLang('');
    expect(result.passed).toBe(false);
  });

  it('rejects numeric string (BVA boundary)', () => {
    const result = matchesLang('12345');
    expect(result.passed).toBe(false);
  });
});

describe('matchesExperience', () => {
  it('rejects senior roles', () => {
    const result = matchesExperience('Senior Software Engineer');
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(['Not matching experience level']);
  });

  it('rejects lead roles', () => {
    expect(matchesExperience('Tech Lead')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });

  it('rejects 3+ years experience', () => {
    expect(matchesExperience('3+ years experience')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });

  it('rejects seniority range', () => {
    expect(matchesExperience('3 to 5 years')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });

  it('rejects Vietnamese experience patterns', () => {
    expect(matchesExperience('kinh nghiem tu 3 nam')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });

  it('passes junior roles', () => {
    expect(matchesExperience('Junior Developer')).toEqual({ passed: true, reasons: [] });
  });

  it('passes entry level', () => {
    expect(matchesExperience('Entry level position')).toEqual({ passed: true, reasons: [] });
  });

  it('rejects empty input', () => {
    expect(matchesExperience('')).toEqual({ passed: false, reasons: ['No experience information'] });
  });

  it('rejects null input (BVA boundary)', () => {
    expect(matchesExperience(null)).toEqual({ passed: false, reasons: ['No experience information'] });
  });

  it('rejects undefined input (BVA boundary)', () => {
    expect(matchesExperience(undefined)).toEqual({ passed: false, reasons: ['No experience information'] });
  });

  it('passes 0 years experience (BVA — only 3+ is rejected)', () => {
    expect(matchesExperience('0 years experience')).toEqual({ passed: true, reasons: [] });
  });

  it('passes 1 year experience (BVA — only 3+ is rejected)', () => {
    expect(matchesExperience('1+ year of experience')).toEqual({ passed: true, reasons: [] });
  });

  it('passes 2 years experience (BVA — only 3+ is rejected)', () => {
    expect(matchesExperience('2 years experience required')).toEqual({ passed: true, reasons: [] });
  });

  it('rejects 3 years experience (BVA boundary at rejection threshold)', () => {
    expect(matchesExperience('3+ years experience')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });

  it('rejects 4 years experience (BVA boundary above threshold)', () => {
    expect(matchesExperience('4 years of experience')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });

  it('rejects senior software engineer pattern', () => {
    expect(matchesExperience('Senior Software Engineer')).toEqual({ passed: false, reasons: ['Not matching experience level'] });
  });
});

