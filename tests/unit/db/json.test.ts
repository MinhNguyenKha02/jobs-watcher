import { describe, it, expect } from 'vitest';
import { canonicalProfile } from '../../../src/infrastructure/outbound/persistence/json.js' ;

describe('canonicalProfile', () => {
  it('contains name', () => {
    expect(canonicalProfile.name).toBe('Minh Nguyen Kha');
  });

  it('contains email', () => {
    expect(canonicalProfile.email).toBe('minhnguyen.kha@proton.me');
  });

  it('contains projects array', () => {
    expect(Array.isArray(canonicalProfile.projects)).toBe(true);
    expect(canonicalProfile.projects.length).toBeGreaterThan(0);
  });

  it('contains experience array', () => {
    expect(Array.isArray(canonicalProfile.experience)).toBe(true);
    expect(canonicalProfile.experience.length).toBeGreaterThan(0);
  });

  it('contains education array', () => {
    expect(Array.isArray(canonicalProfile.education)).toBe(true);
    expect(canonicalProfile.education.length).toBeGreaterThan(0);
  });

  it('contains skills object with backend section', () => {
    expect(canonicalProfile.skills).toBeDefined();
    expect(canonicalProfile.skills.backend).toBeDefined();
  });

  it('contains links object', () => {
    expect(canonicalProfile.links).toBeDefined();
    expect(canonicalProfile.links.github).toContain('github.com');
  });

  it('contains software_fundamentals', () => {
    expect(canonicalProfile.software_fundamentals).toBeDefined();
    expect(Array.isArray(canonicalProfile.software_fundamentals.programming_language.solid)).toBe(true);
  });
});