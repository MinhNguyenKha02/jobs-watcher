import { hybridJobFilter } from '../../src/filter/job-filter.js';
import type { Profile, ParsedEmail } from '../../src/types.js';

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

describe('hybridJobFilter - strict junior/software logic', () => {
  test('Office Manager (non-software) fails', () => {
    const job = makeJob({
      position: 'Office Manager',
      location: 'Ho Chi Minh City',
      description: 'Manage office operations.',
    });
    const res = hybridJobFilter(job, freshGradProfile);
    expect(res.passed).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/non-software/i);
  });

  test('Junior developer (no years requirement) passes with high skill match', () => {
    const job = makeJob({
      position: 'Junior Software Engineer',
      location: 'Remote',
      description: 'We are hiring a junior developer. TypeScript, React, Node.js required.',
    });
    const res = hybridJobFilter(job, freshGradProfile);
    expect(res.passed).toBe(true);
  });

  test('Senior role or any years requirement fails', () => {
    const job = makeJob({
      position: 'Senior Software Engineer',
      location: 'Ho Chi Minh City',
      description: 'Senior role with 5+ years of experience required.',
    });
    const res = hybridJobFilter(job, freshGradProfile);
    expect(res.passed).toBe(false);
    expect(res.reasons.join(' ')).toMatch(/beyond junior/i);
  });

  test('Entry-level or fresh graduate keyword passes', () => {
    const job = makeJob({
      position: 'Entry-Level Developer',
      location: 'Remote',
      description: 'Fresh graduates welcome. No experience required.',
    });
    const res = hybridJobFilter(job, freshGradProfile);
    expect(res.passed).toBe(true);
  });

  test('Mid-level role fails (beyond junior)', () => {
    const job = makeJob({
      position: 'Mid-Level Developer',
      location: 'Remote',
      description: 'We are seeking a mid-level developer with 3-5 years of experience.',
    });
    const res = hybridJobFilter(job, freshGradProfile);
    expect(res.passed).toBe(false);
  });

  test('Job with no technical skills mentioned still passes (skills advisory)', () => {
    const job = makeJob({
      position: 'Junior Software Engineer',
      location: 'Remote',
      description: 'Great opportunity for fresh graduates. Join our dynamic team!',
    });
    const res = hybridJobFilter(job, freshGradProfile);
    expect(res.passed).toBe(true);
  });
});