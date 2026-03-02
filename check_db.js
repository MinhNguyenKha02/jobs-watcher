const { MongoClient } = require('mongodb');
const mongodb_uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const mongo = new MongoClient(mongodb_uri);
(async () => {
  try {
    await mongo.connect();
    const db = mongo.db('jobs_watcher');
    const parseLog = await db.collection('parse_log').countDocuments();
    const needsEnrichment = await db.collection('needs_enrichment').countDocuments();
    console.log(`\n📊 Database collections:\n  - parse_log: ${parseLog}\n  - needs_enrichment: ${needsEnrichment}\n`);
    await mongo.close();
  } catch (e) {
    console.error(e);
  }
})();
