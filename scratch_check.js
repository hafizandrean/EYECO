require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/eyeco';
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB Connected');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
