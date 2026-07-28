import { describe, test, expect } from 'vitest';
import { hybridJobFilter } from '../../src/domain/filter/job-filter.js';

function makeJob(overrides: Record<string, unknown>) {
  return {
    company: (overrides.company as string) ?? 'ACME',
    role: (overrides.role as string) ?? 'Unknown Role',
    location: overrides.location as string | undefined,
    description: overrides.description as string | undefined,
    url: overrides.url as string | undefined,
  };
}

describe('hybridJobFilter - strict junior/software logic', () => {
  test('Office Manager (non-software) fails', () => {
    const job = makeJob({
      role: 'Office Manager',
      description: 'Manage office operations.',
    });
    const res = hybridJobFilter(job);
    expect(res.passed).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/non-software/i);
  });

  test('Junior developer (no years requirement) passes with high skill match', () => {
    const job = makeJob({
      role: 'Junior Software Engineer',
      description: 'We are hiring a junior developer. TypeScript, React, Node.js required.',
    });
    const res = hybridJobFilter(job);
    expect(res.passed).toBe(true);
  });

  test('Senior role passes tier-1 filter (only role is checked)', () => {
    const job = makeJob({
      role: 'Senior Software Engineer',
      description: 'Senior role with 5+ years of experience required.',
    });
    const res = hybridJobFilter(job);
    expect(res.passed).toBe(true);
  });

  test('Entry-level or fresh graduate keyword passes', () => {
    const job = makeJob({
      role: 'Junior Software Engineer',
      description: 'Fresh graduates welcome. No experience required. TypeScript.',
    });
    const res = hybridJobFilter(job);
    expect(res.passed).toBe(true);
  });

  test('Mid-level role fails (no specific software prefix)', () => {
    const job = makeJob({
      role: 'Mid-Level Developer',
      description: 'We are seeking a mid-level developer with 3-5 years of experience.',
    });
    const res = hybridJobFilter(job);
    expect(res.passed).toBe(false);
  });

  test('Job with no technical skills mentioned still passes (skills advisory)', () => {
    const job = makeJob({
      role: 'Junior Software Engineer',
      description: 'Great opportunity for fresh graduates. Join our dynamic team! Node.js.',
    });
    const res = hybridJobFilter(job);
    expect(res.passed).toBe(true);
  });
});
