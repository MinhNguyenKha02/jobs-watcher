import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

const mockCredentials = {
  installed: {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    redirect_uris: ['http://localhost:3000/oauth2callback'],
  },
};

let mockServerHandler: ((req: any, res: any) => void) | null = null;
const mockServerInstance = {
  listen: vi.fn((_port: number, cb: () => void) => cb()),
  close: vi.fn(),
};

vi.mock('googleapis', () => {
  const generateAuthUrl = vi.fn(() => 'https://accounts.google.com/o/oauth2/auth');
  const getToken = vi.fn();
  const setCredentials = vi.fn();
  return {
    google: {
      auth: {
        OAuth2: vi.fn(() => ({ generateAuthUrl, getToken, setCredentials })),
      },
    },
  };
});

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('node:http', () => ({
  default: {
    createServer: vi.fn((handler: (req: any, res: any) => void) => {
      mockServerHandler = handler;
      return mockServerInstance;
    }),
  },
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

describe('auth CLI', () => {
  let processExitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockServerHandler = null;
  });

  it('exits when credentials.json is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await vi.resetModules();
    await import('../../../src/infrastructure/inbound/cli/auth.js' );

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});
