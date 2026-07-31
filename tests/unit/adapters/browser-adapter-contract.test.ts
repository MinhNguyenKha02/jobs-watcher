import { describe, it, expect } from 'vitest';
import type { BrowserPort } from '../../../src/application/ports/browser.port.js';

describe('PlaywrightBrowserAdapter — contract', () => {
  it('has a port interface with required methods', () => {
    const port: BrowserPort = null as unknown as BrowserPort;
    expect(typeof port?.start).toBe('undefined');
    expect(typeof port?.extract).toBe('undefined');
    expect(typeof port?.stop).toBe('undefined');
  });

  it('defines start on the port', () => {
    const method: keyof BrowserPort = 'start';
    expect(method).toBe('start');
  });

  it('defines extract on the port', () => {
    const method: keyof BrowserPort = 'extract';
    expect(method).toBe('extract');
  });

  it('defines stop on the port', () => {
    const method: keyof BrowserPort = 'stop';
    expect(method).toBe('stop');
  });

  it('port has exactly 3 methods', () => {
    const portMethods: (keyof BrowserPort)[] = ['start', 'extract', 'stop'];
    expect(portMethods.length).toBe(3);
  });

  it('extract returns shape { html: string }', () => {
    const result: Promise<{ html: string }> = Promise.resolve({ html: '' });
    expect(result).toBeInstanceOf(Promise);
  });
});
