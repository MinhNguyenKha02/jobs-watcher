/**
 * Simulate a Gmail Pub/Sub push to the webhook.
 * Uses env:
 * - WEBHOOK_URL (optional) full URL, e.g. http://localhost:3000/webhook/gmail
 * - WEBHOOK_PORT (optional) default 3000
 * - WEBHOOK_PATH (optional) default /webhook/gmail
 * - HISTORY_ID (optional) default "1"
 * - INCLUDE_EMAIL (optional) set to 'true' to include sample job email in payload
 * - SEND_REAL_EMAIL (optional) set to 'true' to send actual email to Gmail
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { indeedEmailAlert, topCVEmailAlert } from '../tests/__fixtures__/emails.js';
/**
 * Simulate a Gmail Pub/Sub push to the webhook.
 * Uses env:
 * - WEBHOOK_URL (optional) full URL, e.g. http://localhost:3000/webhook/gmail
 * - WEBHOOK_PORT (optional) default 3000
 * - WEBHOOK_PATH (optional) default /webhook/gmail
 * - HISTORY_ID (optional) default "1"
 * - INCLUDE_EMAIL (optional) set to 'true' to include sample job email in payload
 * - SEND_REAL_EMAIL (optional) set to 'true' to send actual email to Gmail
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

let __dir: string;
try {
  const importMeta = eval('import.meta');
  __dir = path.dirname(fileURLToPath(importMeta.url));
} catch {
  __dir = process.cwd() + '/scripts';
}

const TOKEN_PATH = path.join(__dir, '../token.json');
const CREDENTIALS_PATH = path.join(__dir, '../credentials.json');

const port = process.env.WEBHOOK_PORT || '3000';
const webhookPath = process.env.WEBHOOK_PATH || '/webhook/gmail';
const url = process.env.WEBHOOK_URL || `http://localhost:${port}${webhookPath}`;
const historyId = process.env.HISTORY_ID || '1';
const includeEmail = process.env.INCLUDE_EMAIL === 'true';


// Use only indeedEmailAlert and topCVEmailAlert as possible payloads
const availableAlerts = [indeedEmailAlert, topCVEmailAlert];
// Allow selection via env var, else randomize
const alertIndex = process.env.ALERT_INDEX ? parseInt(process.env.ALERT_INDEX, 10) : Math.floor(Math.random() * availableAlerts.length);
const selectedAlert = availableAlerts[alertIndex] || indeedEmailAlert;

// Ensure envelope fields exist on selectedAlert for webhook consumers
try {
  // id -> messageId
  if (!selectedAlert.messageId && selectedAlert.id) selectedAlert.messageId = selectedAlert.id;
  // Extract headers if present
  if (selectedAlert.payload && Array.isArray(selectedAlert.payload.headers)) {
    const h = selectedAlert.payload.headers;
    const subj = h.find((x: any) => String(x.name).toLowerCase() === 'subject');
    const from = h.find((x: any) => String(x.name).toLowerCase() === 'from');
    if (subj && subj.value && !selectedAlert.subject) selectedAlert.subject = String(subj.value);
    if (from && from.value && !selectedAlert.from) selectedAlert.from = String(from.value);
  }
} catch (err) {
  // noop
}

// For webhook simulation, use selectedAlert as the email payload

const sendRealEmail = process.env.SEND_REAL_EMAIL === 'true';

// Track messageId from real email send
let sentMessageId: string | null = null;

const buildPayload = () => {
  const messageData = includeEmail
    ? {
        historyId,
        email: selectedAlert,
      }
    : sentMessageId
      ? {
          historyId,
          messageId: sentMessageId,
        }
      : { historyId };

  return {
    message: {
      data: Buffer.from(JSON.stringify(messageData)).toString('base64'),
    },
  };
};

async function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error('credentials.json not found. Please download it from Google Cloud Console.');
  }
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
}

async function authenticateGmail() {
  const credentials = await loadCredentials();
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    oAuth2Client.setCredentials(token);
  } else {
    throw new Error('No token found. Please run: npm run auth');
  }

  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

async function sendEmailToGmail(gmailClient: any) {
  // Get user's email address from Gmail profile
  let userEmail = process.env.EMAIL_TO;
  if (!userEmail) {
    const profileRes = await gmailClient.users.getProfile({ userId: 'me' });
    userEmail = profileRes.data.emailAddress;
    console.log(`📧 Using Gmail account: ${userEmail}`);
  }

  const emailContent = `To: ${userEmail}
From: ${userEmail}
Subject: Senior Full Stack Developer Position Open at TechCorp
Content-Type: text/html; charset=UTF-8
MIME-Version: 1.0

<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family: Arial, sans-serif;">
<h2>Senior Full Stack Developer</h2>
<p>Dear Job Seeker,</p>

<p>We're excited to announce an open position for a <strong>Senior Full Stack Developer</strong> at <strong>TechCorp Inc.</strong></p>

<h3>Position Details</h3>
<ul>
  <li><strong>Title:</strong> Senior Full Stack Developer</li>
  <li><strong>Company:</strong> TechCorp Inc.</li>
  <li><strong>Location:</strong> San Francisco, CA (Remote Available)</li>
  <li><strong>Salary:</strong> $120,000 - $160,000 per year</li>
  <li><strong>Type:</strong> Full-time</li>
  <li><strong>Link:</strong> https://techcorp.com/careers/senior-full-stack-developer</li>
</ul>

<h3>Responsibilities</h3>
<ul>
  <li>Design and develop scalable web applications using modern tech stacks</li>
  <li>Implement both frontend (React, Vue.js) and backend (Node.js, Python) solutions</li>
  <li>Collaborate with product and design teams to deliver high-quality features</li>
  <li>Participate in code reviews and mentor junior developers</li>
  <li>Optimize application performance and security</li>
</ul>

<h3>Requirements</h3>
<ul>
  <li>5+ years of professional software development experience</li>
  <li>Strong proficiency in JavaScript/TypeScript and modern frameworks</li>
  <li>Experience with backend development (Node.js, Python, or similar)</li>
  <li>Knowledge of databases (SQL and NoSQL)</li>
  <li>Experience with Git version control and agile workflows</li>
  <li>Excellent problem-solving and communication skills</li>
</ul>

<p>Best regards,<br>
TechCorp Recruitment Team</p>
</body>
</html>`;

  const base64Email = Buffer.from(emailContent).toString('base64');

  try {
    const res = await gmailClient.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: base64Email,
      },
    });

    const messageId = res.data.id;
    console.log(`✅ Email sent successfully! Message ID: ${messageId}`);

    // Get the label ID for "Job-Alerts"
    const labelsRes = await gmailClient.users.labels.list({ userId: 'me' });
    let jobAlertsLabelId = labelsRes.data.labels?.find((l: any) => l.name === 'Job-Alerts')?.id;

    if (!jobAlertsLabelId) {
      console.log('📌 Creating "Job-Alerts" label...');
      const createRes = await gmailClient.users.labels.create({
        userId: 'me',
        requestBody: {
          name: 'Job-Alerts',
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        },
      });
      jobAlertsLabelId = createRes.data.id;
      console.log(`✅ Label "Job-Alerts" created with ID: ${jobAlertsLabelId}`);
    }

    // Add the label to the message
    await gmailClient.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [jobAlertsLabelId],
      },
    });

    console.log(`✅ Email labeled with "Job-Alerts"`);
    sentMessageId = messageId;
    return messageId;
  } catch (error) {
    console.error('❌ Failed to send email:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function sendWebhookNotification(payload: any) {
  const maxAttempts = 5;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Webhook responded ${res.status}: ${text}`);
      }

      const text = await res.text();
      console.log(`✅ Webhook responded ${res.status}: ${text || 'OK'}`);
      if (sentMessageId) {
        console.log(`📧 Payload included messageId: ${sentMessageId}`);
      } else {
        console.log(`📧 Payload included ${includeEmail ? 'sample job email' : 'historyId only'}`);
      }
      return;
    } catch (err) {
      const short = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ Attempt ${attempt}/${maxAttempts} failed: ${short}`);
      if (attempt >= maxAttempts) throw err;
      // Wait before retrying (exponential backoff)
      const backoff = 500 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

// Main execution
(async () => {
  try {
    console.log('🚀 Starting simulation...');
    console.log(`📍 Target webhook URL: ${url}`);

    if (sendRealEmail) {
      console.log('\n📧 Sending real email to Gmail...');
      try {
        const gmailClient = await authenticateGmail();
        await sendEmailToGmail(gmailClient);
      } catch (error) {
        console.error('⚠️  Could not send real email:', error instanceof Error ? error.message : String(error));
        console.log('Continuing with webhook simulation...');
      }
    }

    console.log('\n📬 Sending webhook notification...');
    await sendWebhookNotification(buildPayload());

    console.log('\n✅ Simulation complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Simulation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
