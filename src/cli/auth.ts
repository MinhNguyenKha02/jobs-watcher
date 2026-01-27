import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, '../../credentials.json');
const TOKEN_PATH = path.join(__dirname, '../../token.json');

/**
 * Gmail OAuth2 Authentication
 * 
 * Authenticates with Gmail using OAuth2 flow:
 * 1. Opens browser to Google consent screen
 * 2. User authorizes access to Gmail
 * 3. Stores access token in token.json (local, never shared)
 * 
 * Usage: npm run auth
 */
async function authenticate() {
  console.log('🔐 Gmail Authentication\n');

  // Load credentials
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error('❌ credentials.json not found!');
    console.log('\nPlease:');
    console.log('1. Go to Google Cloud Console: https://console.cloud.google.com');
    console.log('2. Enable Gmail API');
    console.log('3. Create OAuth 2.0 credentials');
    console.log('4. Download credentials.json and place it in the project root');
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Generate auth URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
    ],
  });

  console.log('🌐 Opening browser for authorization...\n');
  console.log('If the browser doesn\'t open, visit this URL:');
  console.log(authUrl);
  console.log('');

  // Start local server to receive callback
  const server = http.createServer(async (req, res) => {
    if (req.url?.includes('/oauth2callback')) {
      const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
      const code = qs.get('code');

      if (code) {
        res.end('✅ Authentication successful! You can close this window.');

        try {
          const { tokens } = await oAuth2Client.getToken(code);
          oAuth2Client.setCredentials(tokens);

          // Save tokens
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
          console.log('✅ Token saved to token.json');
          console.log('🎉 Authentication complete!\n');
          
          server.close();
          process.exit(0);
        } catch (error) {
          console.error('❌ Error getting tokens:', error);
          process.exit(1);
        }
      }
    }
  });

  server.listen(3000, () => {
    console.log('🚀 Local server started on http://localhost:3000');
    open(authUrl);
  });
}

authenticate().catch(console.error);
