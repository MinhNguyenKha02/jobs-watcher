import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let __dir: string;
try {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('test env');
  }
  // Use eval to prevent Jest from parsing import.meta at syntax level
  const importMeta = eval('import.meta');
  __dir = path.dirname(fileURLToPath(importMeta.url));
} catch {
  __dir = process.cwd() + '/src/services';
}
const TOKEN_PATH = path.join(__dir, '../../token.json');
const CREDENTIALS_PATH = path.join(__dir, '../../credentials.json');

export class GmailService {
  private auth: any;
  private gmail: any;

  constructor(gmailClient?: any, authClient?: any) {
    this.gmail = gmailClient;
    this.auth = authClient;
  }

  private ensureClient() {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized. Call authenticate() first.');
    }
    return this.gmail;
  }

  async authenticate() {
    const credentials = this.loadCredentials();
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // Check if we have previously stored a token
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      oAuth2Client.setCredentials(token);
    } else {
      throw new Error('No token found. Please run: npm run auth');
    }

    this.auth = oAuth2Client;
    this.gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  private loadCredentials() {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      throw new Error(
        'credentials.json not found. Please download it from Google Cloud Console.'
      );
    }
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  }

  /**
   * List messages by query string or labelId
   * Can be called as:
   * - listMessages('from:jobs@linkedin.com')  // Query string
   * - listMessages(labelId, 1)                // With maxResults
   * - listMessagesByLabel(labelId, 1)         // Explicit label query
   */
  async listMessages(queryOrLabelId: string, maxResults = 10) {
    const gmail = this.ensureClient();
    
    // If it looks like a query (contains : or special chars), use as query
    // Otherwise treat as labelId
    const isQuery = /[:><"-]/.test(queryOrLabelId);
    
    if (isQuery) {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: queryOrLabelId,
        maxResults,
      });
      return res.data.messages || [];
    } else {
      // Treat as labelId
      const res = await gmail.users.messages.list({
        userId: 'me',
        labelIds: [queryOrLabelId],
        maxResults,
      });
      return res.data.messages || [];
    }
  }

  /**
   * Explicitly list messages by label ID
   */
  async listMessagesByLabel(labelId: string, maxResults = 10) {
    const gmail = this.ensureClient();
    const res = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      maxResults,
    });
    return res.data.messages || [];
  }

  async getLabelId(labelName: string): Promise<string> {
    const gmail = this.ensureClient();
    const res = await gmail.users.labels.list({ userId: 'me' });
    const label = res.data.labels?.find((l: any) => l.name === labelName);
    
    if (!label) {
      throw new Error(`Label "${labelName}" not found. Please create it in Gmail.`);
    }
    
    return label.id;
  }

  async setupWatch(labelIdOrTopicName: string, topicName?: string): Promise<void> {
    const gmail = this.ensureClient();
    const resolvedTopic = topicName || labelIdOrTopicName;
    const labelIds = topicName ? [labelIdOrTopicName] : ['INBOX'];
    try {
      await gmail.users.watch({
        userId: 'me',
        requestBody: {
          labelIds,
          topicName: resolvedTopic,
          labelFilterAction: 'include',
        },
      });
      console.log(`✅ Gmail watch set up for label IDs: ${labelIds.join(', ')}`);
    } catch (error: any) {
      console.error('Failed to set up Gmail watch:', error.message);
      throw error;
    }
  }

  async getMessage(messageId: string) {
    const gmail = this.ensureClient();
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    return res.data;
  }

  async getMessageRaw(messageId: string): Promise<string> {
    const gmail = this.ensureClient();
    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'raw',
    });
    
    if (res.data.raw) {
      return Buffer.from(res.data.raw, 'base64').toString('utf-8');
    }
    
    return '';
  }

  /**
   * Return message IDs added since a given historyId.
   * Optionally filter by a Gmail labelId.
   */
  async getMessagesSinceHistory(historyId: string, labelId?: string): Promise<string[]> {
    const gmail = this.ensureClient();
    const res = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: historyId,
      labelId,
    });

    const history = res.data.history || [];
    const ids: string[] = [];

    for (const h of history) {
      const added = h.messagesAdded || [];
      for (const m of added) {
        const id = m.message?.id;
        if (id) ids.push(id);
      }
    }

    // Deduplicate
    return Array.from(new Set(ids));
  }

      async markAsRead(messageId: string): Promise<void> {
        const gmail = this.ensureClient();
        await gmail.users.messages.modify({
          userId: 'me',
          id: messageId,
          requestBody: {
            removeLabelIds: ['UNREAD'],
          },
        });
      }

      async listHistory(startHistoryId: string) {
        const gmail = this.ensureClient();
        const res = await gmail.users.history.list({
          userId: 'me',
          startHistoryId,
        });

        return {
          history: res.data.history || [],
          historyId: res.data.historyId,
        };
      }

  extractHeader(message: any, headerName: string): string {
    const header = message.payload?.headers?.find(
      (h: any) => h.name.toLowerCase() === headerName.toLowerCase()
    );
    return header?.value || '';
  }

  extractBody(message: any): string {
    let body = '';

    const getParts = (parts: any[]): void => {
      parts.forEach((part) => {
        if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
          if (part.body?.data) {
            body += Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
        }
        if (part.parts) {
          getParts(part.parts);
        }
      });
    };

    if (message.payload?.parts) {
      getParts(message.payload.parts);
    } else if (message.payload?.body?.data) {
      body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    }

    return body;
  }
}
