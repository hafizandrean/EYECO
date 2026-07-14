const mongoose = require('mongoose');
require('dotenv').config();

const OutboxEventSchema = new mongoose.Schema({
  aggregateType: String,
  aggregateId: String,
  eventType: String,
  payload: mongoose.Schema.Types.Mixed,
  status: String,
  retryCount: Number,
  processedAt: Date
}); // Default mongoose collection name

const OutboxEventModel = mongoose.model('OutboxEvent', OutboxEventSchema);

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eyeco';
  await mongoose.connect(mongoUri);

  const events = await OutboxEventModel.find({}).sort({ _id: -1 }).limit(10);
  console.log('Latest Outbox Events:');
  for (const e of events) {
    console.log(`- ID: ${e._id}, Report ID: ${e.aggregateId}, Status: ${e.status}, Sent Channels: ${JSON.stringify(e.payload?.sentChannels)}, Processed At: ${e.processedAt}`);
  }

  await mongoose.connection.close();
}

main().catch(console.error);
