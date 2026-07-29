import mongoose from 'mongoose';
import 'dotenv/config';

const uri = 'mongodb+srv://boltxa_db_user:eyeco123@eyeco.2arktj6.mongodb.net/?retryWrites=true&w=majority&appName=eyeco';
await mongoose.connect(uri);
const db = mongoose.connection.db;

const userIds = await db.collection('sessions').distinct('userId');
let deleted = 0;
for (const uid of userIds) {
  const sessions = await db.collection('sessions').find({ userId: uid }).sort({ lastActive: -1 }).toArray();
  if (sessions.length > 1) {
    const keepId = sessions[0]._id;
    const result = await db.collection('sessions').deleteMany({ userId: uid, _id: { $ne: keepId } });
    deleted += result.deletedCount;
  }
}
console.log(`Cleaned ${deleted} duplicate sessions`);
process.exit(0);
