import fs from 'fs';
import { GmailService } from '../../src/services/gmail';
import { google } from 'googleapis';

jest.mock('googleapis', () => {
  const gmail = jest.fn();
  const OAuth2 = jest.fn();
  return { google: { gmail, auth: { OAuth2 } } };
});

describe('GmailService - Integration Tests', () => {
  let service: GmailService;
  let mockGmailApi: any;
  let existsSyncSpy: jest.SpyInstance;
  let readFileSyncSpy: jest.SpyInstance;
  let setCredentials: jest.Mock;
  const mockedGoogle: any = google;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    mockGmailApi = {
      users: {
        messages: {
          list: jest.fn(),
          get: jest.fn(),
          modify: jest.fn(),
        },
        labels: {
          list: jest.fn(),
        },
        history: {
          list: jest.fn(),
        },
        watch: jest.fn(),
        stop: jest.fn(),
      },
    };

    (mockedGoogle.gmail as jest.Mock).mockReturnValue(mockGmailApi);
    setCredentials = jest.fn();
    (mockedGoogle.auth.OAuth2 as jest.Mock).mockImplementation(() => ({
      setCredentials,
    }));

    existsSyncSpy = jest.spyOn(fs, 'existsSync').mockImplementation(() => true);
    readFileSyncSpy = jest
      .spyOn(fs, 'readFileSync')
      .mockImplementation((filePath: any) => {
        const file = String(filePath);
        if (file.includes('credentials')) {
          return JSON.stringify({
            installed: {
              client_id: 'test-client-id',
              client_secret: 'test-client-secret',
              redirect_uris: ['http://localhost:3000'],
            },
          });
        }
        return JSON.stringify({ access_token: 'token', refresh_token: 'refresh' });
      });

    service = new GmailService();
    (service as any).gmail = mockGmailApi;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('listMessages', () => {
    it('returns Gmail messages when present', async () => {
      mockGmailApi.users.messages.list.mockResolvedValue({
        data: {
          messages: [
            { id: 'msg-001', threadId: 'thread-001' },
            { id: 'msg-002', threadId: 'thread-002' },
          ],
        },
      });

      const result = await service.listMessages('from:jobs@linkedin.com');

      expect(result).toHaveLength(2);
      expect(mockGmailApi.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'from:jobs@linkedin.com',
        maxResults: 10,
      });
    });

    it('returns an empty array when Gmail returns no messages', async () => {
      mockGmailApi.users.messages.list.mockResolvedValue({ data: {} });

      const result = await service.listMessages('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getMessage', () => {
    it('fetches a full message', async () => {
      mockGmailApi.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg-001',
          payload: {
            headers: [],
            body: { data: Buffer.from('body').toString('base64') },
          },
        },
      });

      const result = await service.getMessage('msg-001');

      expect(result.id).toBe('msg-001');
      expect(mockGmailApi.users.messages.get).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-001',
        format: 'full',
      });
    });
  });

  describe('markAsRead', () => {
    it('removes the UNREAD label', async () => {
      mockGmailApi.users.messages.modify.mockResolvedValue({});

      await service.markAsRead('msg-001');

      expect(mockGmailApi.users.messages.modify).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg-001',
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    });
  });

  describe('setupWatch', () => {
    it('configures a watch with default INBOX label', async () => {
      mockGmailApi.users.watch.mockResolvedValue({ data: { historyId: '12345' } });

      await service.setupWatch('projects/test-project/topics/test-topic');

      expect(mockGmailApi.users.watch).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          labelIds: ['INBOX'],
          topicName: 'projects/test-project/topics/test-topic',
          labelFilterAction: 'include',
        },
      });
    });
  });

  describe('listHistory', () => {
    it('returns history entries', async () => {
      mockGmailApi.users.history.list.mockResolvedValue({
        data: {
          history: [{ id: '12345', messages: [{ id: 'msg-001' }] }],
          historyId: '12346',
        },
      });

      const result = await service.listHistory('12345');

      expect(result.history).toHaveLength(1);
      expect(result.historyId).toBe('12346');
      expect(mockGmailApi.users.history.list).toHaveBeenCalledWith({
        userId: 'me',
        startHistoryId: '12345',
      });
    });
  });

  describe('authenticate', () => {
    it('loads credentials and token without touching real files', async () => {
      service = new GmailService();

      await service.authenticate();

      expect(mockedGoogle.auth.OAuth2).toHaveBeenCalledWith(
        'test-client-id',
        'test-client-secret',
        'http://localhost:3000'
      );
      expect(setCredentials).toHaveBeenCalledWith({ access_token: 'token', refresh_token: 'refresh' });
      expect(mockedGoogle.gmail).toHaveBeenCalled();
    });

    it('throws when credentials.json is missing', async () => {
      existsSyncSpy.mockImplementation((filePath: any) => !String(filePath).includes('credentials'));

      await expect(new GmailService().authenticate()).rejects.toThrow('credentials.json not found');
    });

    it('throws when token.json is missing', async () => {
      existsSyncSpy.mockImplementation((filePath: any) => {
        const file = String(filePath);
        if (file.includes('credentials')) return true;
        if (file.includes('token')) return false;
        return true;
      });

      await expect(new GmailService().authenticate()).rejects.toThrow('No token found');
    });
  });
});
