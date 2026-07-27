import { describe, it, expect } from 'vitest';
import { flattenJob, flattenJobDetails } from '../../../src/domain/services/flatten-job.js' ;

describe('flattenJob', () => {
  it('returns formatted string with all fields', () => {
    const result = flattenJob({
      role: 'Software Engineer',
      company: 'Tech Corp',
      description: 'Build things',
      salary: '$100k',
      location: 'Remote',
      details: {
        responsibilities: 'Code review',
        requirements: '5 years exp',
      },
    });

    expect(result).toContain('Role:');
    expect(result).toContain('Software Engineer');
    expect(result).toContain('Company:');
    expect(result).toContain('Tech Corp');
    expect(result).toContain('Description:');
    expect(result).toContain('Build things');
    expect(result).toContain('Salary:');
    expect(result).toContain('$100k');
    expect(result).toContain('Location:');
    expect(result).toContain('Remote');
    expect(result).toContain('Responsibilities:');
    expect(result).toContain('Code review');
  });

  it('handles partial fields', () => {
    const result = flattenJob({
      role: 'Developer',
      company: 'Startup',
      description: '',
      salary: undefined,
      location: undefined,
      details: undefined,
    });

    expect(result).toContain('Developer');
    expect(result).toContain('Startup');
    expect(result).not.toContain('Salary:');
    expect(result).not.toContain('Location:');
  });

  it('returns empty string for empty input', () => {
    const result = flattenJob({
      role: '',
      company: '',
      description: '',
      salary: undefined,
      location: undefined,
      details: undefined,
    });

    expect(result).toBe('');
  });
});

describe('flattenJobDetails', () => {
  it('formats known detail labels', () => {
    const result = flattenJobDetails({
      responsibilities: 'Task A\nTask B',
      benefits: 'Health insurance',
    });

    expect(result).toContain('Responsibilities:');
    expect(result).toContain('Task A');
    expect(result).toContain('Benefits:');
    expect(result).toContain('Health insurance');
  });

  it('handles extraSections', () => {
    const result = flattenJobDetails({
      responsibilities: 'Main task',
      extraSections: {
        'Certifications': 'AWS Certified',
        'Languages': 'English, Vietnamese',
      },
    });

    expect(result).toContain('Certifications:');
    expect(result).toContain('AWS Certified');
    expect(result).toContain('Languages:');
  });

  it('returns empty string for undefined details', () => {
    expect(flattenJobDetails(undefined)).toBe('');
  });

  it('skips empty string values', () => {
    const result = flattenJobDetails({
      responsibilities: '',
      requirements: 'Must have',
    });

    expect(result).not.toContain('Responsibilities:');
    expect(result).toContain('Requirements:');
  });

  it('uses raw key as label for unknown fields', () => {
    const result = flattenJobDetails({
      customField: 'custom value',
    });

    expect(result).toContain('customField:');
    expect(result).toContain('custom value');
  });

  it('joins sections with double newline', () => {
    const result = flattenJobDetails({
      responsibilities: 'Resp',
      requirements: 'Req',
    });

    expect(result).toContain('Responsibilities:\nResp\n\nRequirements:\nReq');
  });
});
