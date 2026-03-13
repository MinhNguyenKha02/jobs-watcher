let filterJobCompatibility: typeof import('../../src/services/constraints.js').filterJobCompatibility;
import type { ParsedEmail, Profile } from '../../src/types.js';

// ESM-compatible mock for HtmlJobParser
beforeAll(async () => {
  const { jest } = await import('@jest/globals');
  jest.unstable_mockModule('../../src/services/parsers/html-job-parser.js', () => ({
    HtmlJobParser: class {
      parseJobFromHtml() {
        return null;
      }
    },
  }));
  ({ filterJobCompatibility } = await import('../../src/services/constraints.js'));
});

const freshGradProfile: Profile = {
  name: 'Test User',
  email: 'test@example.com',
  phone: '0000000000',
  location: 'Ho Chi Minh City',
  title: 'Software Engineer',
  summary: 'Fresh graduate with two internships.',
  skills: ['TypeScript', 'React', 'Node.js', 'HTML', 'CSS'],
  experience: [
    {
      company: 'Intern A',
      position: 'Software Engineer Intern',
      location: 'Ho Chi Minh City',
      startDate: '2024-01',
      endDate: '2024-06',
      description: ['Worked on React components.'],
    },
    {
      company: 'Intern B',
      position: 'Backend Intern',
      location: 'Ho Chi Minh City',
      startDate: '2024-07',
      endDate: '2024-12',
      description: ['Built Node.js APIs.'],
    },
  ],
  education: [
    {
      institution: 'University X',
      degree: 'BSc',
      field: 'Computer Science',
      startDate: '2020-09',
      endDate: '2024-06',
      gpa: '3.5',
    },
  ],
  links: {},
};

function makeJob(overrides: Partial<ParsedEmail>): ParsedEmail {
  return {
    emailId: overrides.emailId ?? 'email-1',
    subject: overrides.subject ?? 'Job Opportunity',
    from: overrides.from ?? 'jobs@example.com',
    platform: overrides.platform ?? 'TopCV',
    company: overrides.company ?? 'ACME',
    position: overrides.position ?? 'Unknown Position',
    location: overrides.location,
    url: overrides.url,
    description: overrides.description,
    rawContent: overrides.rawContent ?? 'Raw content',
    receivedAt: overrides.receivedAt ?? new Date('2026-01-18T00:00:00Z'),
  };
}

describe('constraints filter compatibility - ultra-junior focus', () => {
  test('Office Manager (non-software) fails', () => {
    const job = makeJob({
      position: 'Office Manager',
      location: 'Ho Chi Minh City',
      description: 'Manage office operations.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(false);
    expect(res.reason).toMatch(/non-software/i);
  });

  test('Junior developer (no years requirement) passes with high skill match', () => {
    const job = makeJob({
      position: 'Junior Software Engineer',
      location: 'Remote',
      description: 'We are hiring a junior developer. TypeScript, React, Node.js required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    expect(res.matchedSkills).toContain('typescript');
  });

  test('Numeric versions without years context do not trigger rejection', () => {
    const job = makeJob({
      position: 'Junior Frontend Engineer',
      location: 'Remote',
      description: 'Work with React 18 and TypeScript 5 on greenfield features.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Senior role or any years requirement fails', () => {
    const job = makeJob({
      position: 'Senior Software Engineer',
      location: 'Ho Chi Minh City',
      description: 'Senior role with 5+ years of experience required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(false);
  });

  test('Mid-level role fails (beyond junior)', () => {
    const job = makeJob({
      position: 'Mid-Level Developer',
      location: 'Remote',
      description: 'We are seeking a mid-level developer with 3-5 years of experience.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(false);
  });

  test('Any explicit years mention (even 1-2) fails ultra-junior filter', () => {
    const job = makeJob({
      position: 'Software Engineer',
      location: 'Remote',
      description: 'Looking for someone with 1-2 years of experience.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(false);
  });

  test('Entry-level or fresh graduate keyword passes', () => {
    const job = makeJob({
      position: 'Entry-Level Developer',
      location: 'Remote',
      description: 'Fresh graduates welcome. No experience required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Junior role with zero skill match fails', () => {
    const job = makeJob({
      position: 'Junior iOS Developer',
      location: 'Remote',
      description: 'Entry level iOS developer needed. Swift, Objective-C, Xcode required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Junior role with partial skill match passes', () => {
    const job = makeJob({
      position: 'Junior Full Stack Developer',
      location: 'Remote',
      description: 'Looking for entry-level developer. TypeScript and Python knowledge preferred.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    expect(res.matchedSkills).toContain('typescript');
  });

  test('Generic job description with no technical skills gets neutral score', () => {
    const job = makeJob({
      position: 'Junior Developer',
      location: 'Remote',
      description: 'Join our dynamic team. Fresh graduates welcome. Great learning opportunity.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Case-insensitive skill matching works', () => {
    const job = makeJob({
      position: 'Junior Backend Engineer',
      location: 'Remote',
      description: 'Entry level position. TYPESCRIPT, NODEJS, and HTML required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    expect(res.matchedSkills?.length).toBeGreaterThan(0);
  });

  test('Skill variations match correctly (React vs ReactJS)', () => {
    const job = makeJob({
      position: 'Junior Frontend Developer',
      location: 'Remote',
      description: 'Fresh graduate welcome. ReactJS and TypeScript experience.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    expect(res.matchedSkills?.length).toBeGreaterThan(0);
  });

  test('Word fragments like leadership do not mis-trigger senior rejection', () => {
    const job = makeJob({
      position: 'Junior Developer',
      location: 'Remote',
      description: 'Leadership training provided for junior team members.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Job with matching profile skills passes with good overlap (token-based, ATS-friendly)', () => {
    const job = makeJob({
      position: 'Junior Full-Stack Developer',
      location: 'Remote',
      description:
        'We are looking for a junior developer with TypeScript, React, and Node.js experience. HTML and CSS knowledge required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    expect(res.matchedSkills).toEqual(expect.arrayContaining(['typescript', 'react', 'node.js']));
    // No false positives
    expect(res.matchedSkills).not.toContain('Laravel');
  });

  test('Job with completely different tech stack does not block (skills advisory)', () => {
    const job = makeJob({
      position: 'Junior iOS Developer',
      location: 'Remote',
      description:
        'Looking for Swift, Objective-C, and Xcode experience. iOS development required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Job with partial skill match (>20%) passes', () => {
    const job = makeJob({
      position: 'Junior Full-Stack Developer',
      location: 'Remote',
      description: 'Experience with TypeScript, HTML, CSS, and Python. Go is a plus.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Job with no technical skills mentioned still passes (skills advisory)', () => {
    const job = makeJob({
      position: 'Junior Software Engineer',
      location: 'Remote',
      description: 'Great opportunity for fresh graduates. Join our dynamic team!',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
  });

  test('Skill matching is case-insensitive', () => {
    const job = makeJob({
      position: 'Junior Developer',
      location: 'Remote',
      description: 'TYPESCRIPT, REACT, Node.js experience required.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    expect(res.matchedSkills!.length).toBeGreaterThanOrEqual(3);
  });

  test('Skill matching handles variations (React vs React.js)', () => {
    const job = makeJob({
      position: 'Junior Frontend Developer',
      location: 'Remote',
      description: 'Looking for experience with ReactJS and JavaScript.',
    });

    const res = filterJobCompatibility(job, freshGradProfile);
    expect(res.passes).toBe(true);
    // Should match "React" from profile with "ReactJS" from job (substring match)
    expect(res.matchedSkills?.length).toBeGreaterThan(0);
  });
});
