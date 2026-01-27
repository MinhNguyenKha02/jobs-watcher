import 'dotenv/config';
import { PubSub } from '@google-cloud/pubsub';

/**
 * Delete a Pub/Sub subscription by name.
 */
async function main() {
  const subscriptionName = process.env.PUBSUB_SUBSCRIPTION || 'job-alerts-sub';
  const pubsub = new PubSub();

  console.log(`🗑️  Deleting subscription: ${subscriptionName}`);
  try {
    await pubsub.subscription(subscriptionName).delete();
    console.log('✅ Subscription deleted');
  } catch (err: any) {
    console.error('❌ Failed to delete subscription:', err?.message || err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
