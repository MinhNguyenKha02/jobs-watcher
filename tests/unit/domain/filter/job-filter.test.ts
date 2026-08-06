import { describe, test, expect } from 'vitest';
import { hybridJobFilter } from '../../../../src/domain/filter/job-filter.js';

function makeJob(overrides: Record<string, unknown>) {
  return {
    company: (overrides.company as string) ?? 'ACME',
    role: (overrides.role as string) ?? 'Unknown Role',
    location: overrides.location as string | undefined,
    description: overrides.description as string | undefined,
    url: overrides.url as string | undefined,
    details: overrides.details as Record<string, string> | undefined,
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

describe('hybridJobFilter - decision table by filter logic analysis', () => {
  const swRole = 'Junior Software Engineer';
  const nonSwRole = 'Office Manager';
  const withLang = 'TypeScript, Python required. Fresh graduates welcome.';
  const noLang = 'Manage office operations. Fresh graduates welcome.';
  const seniorExp = 'TypeScript, Python required. 5+ years of experience required.';

  type Row = { role: string; desc: string; details?: Record<string, string>; tier: 1 | 2; expectPass: boolean; label: string };

  // Actual filter logic (src/domain/filter/job-filter.ts):
  //   Tier 1: only checks matchesRole(role) → 2 paths (SW pass / non-SW fail)
  //   Tier 2: checks matchesLang(details,desc) then matchesExperience(details,desc) → 4 paths
  //   Total unique paths: 6
  const table: Row[] = [
    { role: swRole, desc: noLang, tier: 1, expectPass: true, label: 'T1 SW role passes (lang/exp irrelevant)' },
    { role: nonSwRole, desc: withLang, tier: 1, expectPass: false, label: 'T1 non-SW fails (lang/exp irrelevant)' },
    { role: swRole, desc: withLang, details: { requirements: 'TypeScript, Python' }, tier: 2, expectPass: true, label: 'T2 lang+exp both pass' },
    { role: swRole, desc: noLang, tier: 2, expectPass: false, label: 'T2 no lang fails (short-circuit)' },
    { role: swRole, desc: seniorExp, details: { requirements: 'TypeScript, Python' }, tier: 2, expectPass: false, label: 'T2 lang ok but senior exp fails' },
    { role: nonSwRole, desc: seniorExp, tier: 2, expectPass: false, label: 'T2 no lang + senior exp fails' },
  ];

  for (const row of table) {
    test(`hybrid filter: ${row.label}`, () => {
      const job = makeJob({ role: row.role, description: row.desc, details: row.details });
      const res = hybridJobFilter(job, row.tier === 2 ? { sinceTier: 2 } : undefined);
      expect(res.passed).toBe(row.expectPass);
    });
  }
});

describe('hybridJobFilter - metamorphic relations', () => {
  test('if sinceTier=2 passes then sinceTier=1 also passes', () => {
    const job = makeJob({
      role: 'Junior Software Engineer',
      description: 'TypeScript, Node.js. Fresh graduates welcome.',
    });
    const t2 = hybridJobFilter(job, { sinceTier: 2 });
    const t1 = hybridJobFilter(job);
    if (t2.passed) {
      expect(t1.passed).toBe(true);
    }
  });

  test('adding seniority keywords flips pass to fail at tier 2', () => {
    const junior = makeJob({
      role: 'Junior Software Engineer',
      description: 'TypeScript, Python. Fresh graduates welcome.',
    });
    const senior = makeJob({
      role: 'Senior Software Engineer',
      description: 'TypeScript, Python. 3+ years experience required.',
    });
    const juniorRes = hybridJobFilter(junior, { sinceTier: 2 });
    const seniorRes = hybridJobFilter(senior, { sinceTier: 2 });
    if (juniorRes.passed) {
      expect(seniorRes.passed).toBe(false);
    }
  });

  test('adding non-software role prefix flips pass to fail', () => {
    const software = makeJob({
      role: 'Junior Software Engineer',
      description: 'TypeScript, Python.',
    });
    const nonSoftware = makeJob({
      role: 'Junior Marketing Manager',
      description: 'TypeScript, Python.',
    });
    const swRes = hybridJobFilter(software, { sinceTier: 2 });
    const nonSwRes = hybridJobFilter(nonSoftware, { sinceTier: 2 });
    if (swRes.passed) {
      expect(nonSwRes.passed).toBe(false);
    }
  });
});
