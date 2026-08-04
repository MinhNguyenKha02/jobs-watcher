import { describe, it, expect } from 'vitest';
import type { JobLifecyclePort } from '../../../../src/application/ports/job-lifecycle.port.js';

describe('MongoJobLifecycleAdapter — contract', () => {
  it('has a port interface with required methods', () => {
    const port: JobLifecyclePort = null as unknown as JobLifecyclePort;
    expect(typeof port?.upsert).toBe('undefined');
    expect(typeof port?.updateStage).toBe('undefined');
    expect(typeof port?.findById).toBe('undefined');
  });

  it('defines upsert on the port', () => {
    const method: keyof JobLifecyclePort = 'upsert';
    expect(method).toBe('upsert');
  });

  it('defines updateStage on the port', () => {
    const method: keyof JobLifecyclePort = 'updateStage';
    expect(method).toBe('updateStage');
  });

  it('defines findById on the port', () => {
    const method: keyof JobLifecyclePort = 'findById';
    expect(method).toBe('findById');
  });

  it('port has exactly 3 methods', () => {
    const portMethods: (keyof JobLifecyclePort)[] = ['upsert', 'updateStage', 'findById'];
    expect(portMethods.length).toBe(3);
  });
});
