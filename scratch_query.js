const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://boltxa_db_user:eyeco123@eyeco.2arktj6.mongodb.net/?retryWrites=true&w=majority&appName=eyeco';

const reportSchema = new mongoose.Schema({}, { strict: false });
const Report = mongoose.model('Report', reportSchema);

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');
  const reports = await Report.find({}).sort({ timestamp: -1 }).limit(10);
  console.log('Total reports in DB:', await Report.countDocuments());
  console.log('Latest 10 reports:', reports.map(r => ({ id: r.id, location: r.location, timestamp: r.timestamp, status: r.status })));
  await mongoose.disconnect();
}

main().catch(console.error);
