import { describe, it, expect } from 'vitest';

import { flattenJob, flattenJobDetails } from '../../../../src/domain/services/flatten-job.js';

describe('flattenJob', () => {
  it('GIVEN flattenJob input with all fields WHEN flattenJob evaluates THEN returns formatted string with all fields', () => {
    const result = flattenJob({
      role: 'Software Engineer',
      company: 'Tech Corp',
      description: 'Build things',
      salary: '$100k',
      location: 'Remote',
      details: 'Responsibilities:\nCode review\n\nRequirements:\n5 years exp',
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

  it('GIVEN flattenJob input with partial fields WHEN flattenJob evaluates THEN handles partial fields', () => {
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

  it('GIVEN flattenJob input empty WHEN flattenJob evaluates THEN returns empty string for empty input', () => {
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
  it('GIVEN flattenJobDetails input string with sections WHEN flattenJobDetails evaluates THEN returns the text as-is', () => {
    const result = flattenJobDetails(
      'Responsibilities:\nTask A\nTask B\n\nBenefits:\nHealth insurance'
    );

    expect(result).toContain('Responsibilities:');
    expect(result).toContain('Task A');
    expect(result).toContain('Benefits:');
    expect(result).toContain('Health insurance');
  });

  it('GIVEN flattenJobDetails input string with custom sections WHEN flattenJobDetails evaluates THEN preserves raw section labels', () => {
    const result = flattenJobDetails(
      'Main task\n\ncertifications:\nAWS Certified\n\nlanguages:\nEnglish, Vietnamese'
    );

    expect(result).toContain('certifications:');
    expect(result).toContain('AWS Certified');
    expect(result).toContain('languages:');
  });

  it('GIVEN flattenJobDetails input "undefined" WHEN flattenJobDetails evaluates THEN returns empty string for undefined details', () => {
    expect(flattenJobDetails(undefined)).toBe('');
  });

  it('GIVEN flattenJobDetails input "" WHEN flattenJobDetails evaluates THEN returns empty string for empty details', () => {
    expect(flattenJobDetails('')).toBe('');
  });

  it('GIVEN flattenJobDetails input plain text WHEN flattenJobDetails evaluates THEN returns identical string (identity)', () => {
    const text = 'Requirements:\nMust have';
    expect(flattenJobDetails(text)).toBe(text);
  });
});
