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
  // Decision family (tier 1): matchesRole decides everything; lang/experience irrelevant.
  const logicRows: Array<{
    role: string;
    description: string;
    expectPass: boolean;
    reason?: RegExp;
  }> = [
    {
      role: 'Office Manager',
      description: 'Manage office operations.',
      expectPass: false,
      reason: /non-software/i,
    },
    {
      role: 'Junior Software Engineer',
      description: 'We are hiring a junior developer. TypeScript, React, Node.js required.',
      expectPass: true,
    },
    {
      role: 'Senior Software Engineer',
      description: 'Senior role with 5+ years of experience required.',
      expectPass: true,
    },
    {
      role: 'Junior Software Engineer',
      description: 'Fresh graduates welcome. No experience required. TypeScript.',
      expectPass: true,
    },
    {
      role: 'Mid-Level Developer',
      description: 'We are seeking a mid-level developer with 3-5 years of experience.',
      expectPass: false,
      reason: /non-software/i,
    },
    {
      role: 'Junior Software Engineer',
      description: 'Great opportunity for fresh graduates. Join our dynamic team! Node.js.',
      expectPass: true,
    },
  ];

  it.each(logicRows.map((row) => [row.role, row.description, row.expectPass, row.reason] as const))(
    'GIVEN hybridJobFilter input %s WHEN hybridJobFilter evaluates THEN %s passes = %s',
    (role, description, expectPass, reason) => {
      const res = hybridJobFilter(makeJob({ role, description }));
      expect(res.passed).toBe(expectPass);
      if (reason) expect(res.reasons.join(' ')).toMatch(reason);
    }
  );
});

describe('hybridJobFilter - decision table by filter logic analysis', () => {
  const swRole = 'Junior Software Engineer';
  const nonSwRole = 'Office Manager';
  const withLang = 'TypeScript, Python required. Fresh graduates welcome.';
  const noLang = 'Manage office operations. Fresh graduates welcome.';
  const seniorExp = 'TypeScript, Python required. 5+ years of experience required.';

  type Row = {
    role: string;
    desc: string;
    details?: Record<string, string>;
    tier: 1 | 2;
    expectPass: boolean;
    label: string;
  };

  // Actual filter logic (src/domain/filter/job-filter.ts):
  //   Tier 1: only checks matchesRole(role) → 2 paths (SW pass / non-SW fail)
  //   Tier 2: checks matchesLang(details,desc) then matchesExperience(details,desc) → 4 paths
  //   Total unique paths: 6
  const table: Row[] = [
    {
      role: swRole,
      desc: noLang,
      tier: 1,
      expectPass: true,
      label: 'T1 SW role passes (lang/exp irrelevant)',
    },
    {
      role: nonSwRole,
      desc: withLang,
      tier: 1,
      expectPass: false,
      label: 'T1 non-SW fails (lang/exp irrelevant)',
    },
    {
      role: swRole,
      desc: withLang,
      details: { requirements: 'TypeScript, Python' },
      tier: 2,
      expectPass: true,
      label: 'T2 lang+exp both pass',
    },
    {
      role: swRole,
      desc: noLang,
      tier: 2,
      expectPass: false,
      label: 'T2 no lang fails (short-circuit)',
    },
    {
      role: swRole,
      desc: seniorExp,
      details: { requirements: 'TypeScript, Python' },
      tier: 2,
      expectPass: false,
      label: 'T2 lang ok but senior exp fails',
    },
    {
      role: nonSwRole,
      desc: seniorExp,
      tier: 2,
      expectPass: false,
      label: 'T2 no lang + senior exp fails',
    },
  ];

  it.each(table.map((row) => [row.label, row] as const))('hybrid filter: %s', (_label, row) => {
    const job = makeJob({ role: row.role, description: row.desc, details: row.details });
    const res = hybridJobFilter(job, row.tier === 2 ? { sinceTier: 2 } : undefined);
    expect(res.passed).toBe(row.expectPass);
  });
});

describe('hybridJobFilter - metamorphic relations', () => {
  test('GIVEN sinceTier=2 passes WHEN hybridJobFilter evaluates THEN sinceTier=1 also passes', () => {
    const job = makeJob({
      role: 'Junior Software Engineer',
      description: 'Fresh graduates welcome.',
      details: { requirements: 'TypeScript, Node.js' },
    });
    const t2 = hybridJobFilter(job, { sinceTier: 2 });
    const t1 = hybridJobFilter(job);
    expect(t2.passed).toBe(true);
    expect(t1.passed).toBe(true);
  });

  test('GIVEN hybridJobFilter input "junior" WHEN hybridJobFilter evaluates THEN adding seniority keywords flips pass to fail at tier 2', () => {
    const junior = makeJob({
      role: 'Junior Software Engineer',
      description: 'Fresh graduates welcome.',
      details: { requirements: 'TypeScript, Python' },
    });
    const senior = makeJob({
      role: 'Senior Software Engineer',
      description: '3+ years experience required.',
      details: { requirements: 'TypeScript, Python' },
    });
    const juniorRes = hybridJobFilter(junior, { sinceTier: 2 });
    const seniorRes = hybridJobFilter(senior, { sinceTier: 2 });
    expect(juniorRes.passed).toBe(true);
    expect(seniorRes.passed).toBe(false);
  });

  test('GIVEN hybridJobFilter input "software" WHEN hybridJobFilter evaluates THEN replacing the role with a non-software prefix flips pass to fail at tier 1', () => {
    const software = makeJob({
      role: 'Junior Software Engineer',
      description: 'TypeScript, Python.',
    });
    const nonSoftware = makeJob({
      role: 'Junior Marketing Manager',
      description: 'TypeScript, Python.',
    });
    const swRes = hybridJobFilter(software);
    const nonSwRes = hybridJobFilter(nonSoftware);
    expect(swRes.passed).toBe(true);
    expect(nonSwRes.passed).toBe(false);
  });
});
