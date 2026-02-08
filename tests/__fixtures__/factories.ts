import type { Job, ParsedEmail, Profile } from '../../src/types.js';

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    messageId: 'test-msg-001',
    position: 'Software Developer',
    company: 'Generic Company',
    location: 'Unknown',
    salary: '',
    description: 'Old description that will be replaced',
    url: 'https://example.com',
    platform: 'unknown',
    matchScore: 0,
    matchedSkills: [],
    ...overrides,
  };
}

export function makeParsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    emailId: 'email-001',
    subject: 'Job Alert',
    from: 'alerts@example.com',
    platform: 'unknown',
    receivedAt: new Date(),
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: 'Test User',
    email: 'test@example.com',
    phone: '0000000000',
    location: 'Test City',
    title: 'Software Engineer',
    summary: 'Test profile summary',
    skills: ['TypeScript', 'JavaScript', 'React'],
    experience: [],
    education: [],
    links: {},
    ...overrides,
  };
}
