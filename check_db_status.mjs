import mongoose from 'mongoose';

await mongoose.connect('mongodb+srv://boltxa_db_user:eyeco123@eyeco.2arktj6.mongodb.net/?retryWrites=true&w=majority&appName=eyeco');
const db = mongoose.connection.db;

console.log('=== Reports status ===');
const reports = await db.collection('reports').find({}).sort({ id: -1 }).limit(10).project({ id: 1, adminStatus: 1, telegramStatus: 1, telegramSentAt: 1, telegramError: 1 }).toArray();
console.log(JSON.stringify(reports, null, 2));

console.log('\n=== OutboxEvents (last 10) ===');
const events = await db.collection('outboxevents').find({}).sort({ _id: -1 }).limit(10).toArray();
console.log(JSON.stringify(events, null, 2));

await mongoose.disconnect();
