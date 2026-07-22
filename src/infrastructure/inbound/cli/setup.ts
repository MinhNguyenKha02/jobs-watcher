/**
 * Gmail Setup CLI
 * 
 * Configures Gmail label watch and Pub/Sub webhook:
 * 1. Checks/creates "Job Alerts" label
 * 2. Verifies Pub/Sub topic exists
 * 3. Sets up webhook listener for job emails
 * 
 * Usage: npm run setup
 * Requires: GMAIL_TOPIC_NAME in .env
 */

import { GmailService } from '../../outbound/gmail.js';
import { config } from '../../../config.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setup() {
  console.log('⚙️  Jobs Watcher Setup\n');

  try {
    const gmailService = new GmailService();
    await gmailService.authenticate();

    console.log('✅ Authenticated with Gmail\n');

    // Check label
    console.log(`📧 Checking for label: "${config.gmail.labelName}"`);
    
    let labelId: string;
    try {
      labelId = await gmailService.getLabelId(config.gmail.labelName);
      console.log(`✅ Label found: ${labelId}\n`);
    } catch (error) {
      console.log(`⚠️  Label "${config.gmail.labelName}" not found in Gmail.`);
      console.log('Please create this label manually in Gmail and run setup again.\n');
      process.exit(1);
    }

    // Set up Gmail watch
    console.log('🔔 Setting up Gmail push notifications...');
    
    if (!config.gmail.topicName) {
      console.log('\n⚠️  GMAIL_TOPIC_NAME not set in .env file!');
      console.log('\nYou need to:');
      console.log('1. Create a Pub/Sub topic in Google Cloud Console');
      console.log('2. Grant gmail-api-push@system.gserviceaccount.com publish permissions');
      console.log('3. Set GMAIL_TOPIC_NAME in .env (format: projects/YOUR_PROJECT/topics/gmail-job-alerts)');
      console.log('\nFor now, the service will work but won\'t receive push notifications.');
      console.log('You can manually check for new emails by restarting the service.\n');
      
      const proceed = await question('Continue without push notifications? (y/n): ');
      if (proceed.toLowerCase() !== 'y') {
        process.exit(0);
      }
    } else {
      try {
        await gmailService.setupWatch(labelId, config.gmail.topicName);
        console.log('✅ Gmail watch configured successfully!\n');
      } catch (error: any) {
        console.error('❌ Failed to set up watch:', error.message);
        console.log('\nMake sure:');
        console.log('- Pub/Sub topic exists');
        console.log('- gmail-api-push@system.gserviceaccount.com has publish permissions');
        console.log('- Topic name in .env is correct\n');
      }
    }

    console.log('🎉 Setup complete!');
    console.log('\nNext steps:');
    console.log('1. Edit resources/profile.json with your information');
    console.log('2. Customize templates in templates/ folder');
    console.log('3. Run: npm run dev');
    console.log('');

    rl.close();
  } catch (error: any) {
    console.error('❌ Setup failed:', error.message);
    rl.close();
    process.exit(1);
  }
}

setup();
