import 'dotenv/config';
import { PubSub } from '@google-cloud/pubsub';
import { config } from '../../../config.js';

/**
 * Create a Pub/Sub push subscription that delivers to our webhook endpoint.
 * Requires GOOGLE_APPLICATION_CREDENTIALS env pointing to a service account JSON.
 */
async function main() {
  const topicName = config.gmail.topicName;
  if (!topicName) {
    console.error('❌ Missing config.gmail.topicName (.env: GMAIL_TOPIC_NAME)');
    process.exit(1);
  }

  const subscriptionName = process.env.PUBSUB_SUBSCRIPTION || 'job-alerts-sub';
  const baseEndpoint =
    process.env.PUSH_ENDPOINT || `http://localhost:${config.webhook.port}${config.webhook.path}`;

  const pubsub = new PubSub();

  console.log(`📡 Creating push subscription`);
  console.log(`   Topic: ${topicName}`);
  console.log(`   Subscription: ${subscriptionName}`);
  console.log(`   Push endpoint: ${baseEndpoint}`);

  try {
    const [subscription] = await pubsub.createSubscription(topicName, subscriptionName, {
      pushConfig: {
        pushEndpoint: baseEndpoint,
      },
    });

    console.log(`✅ Subscription created: ${subscription.name}`);
  } catch (err: any) {
    if (err?.code === 6) {
      console.log('ℹ️  Subscription already exists. Updating push config...');
      const subscription = pubsub.subscription(subscriptionName);
      await subscription.modifyPushConfig({ pushEndpoint: baseEndpoint });
      console.log(`✅ Push endpoint updated to ${baseEndpoint}`);
      return;
    }
    console.error('❌ Failed to create subscription:', err?.message || err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
