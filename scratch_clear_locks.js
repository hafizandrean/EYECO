require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/eyeco';
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB Connected');
    
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    // Check for locks
    const LockModel = mongoose.model('SystemLock', new mongoose.Schema({}, { strict: false }), 'systemlocks');
    const locks = await LockModel.find({}).lean().exec();
    console.log('Current Locks:', locks);
    
    if (locks.length > 0) {
      console.log('Clearing all locks...');
      await LockModel.deleteMany({});
      console.log('Locks cleared successfully.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
