const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://EYECO:sZf4fmOlprR7BFpZ@eyeco.setrwjj.mongodb.net/eyeco?retryWrites=true&w=majority';

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    const cctv = await mongoose.connection.db.collection('cctvs').findOne({ id: 8 });
    console.log('CCTV 8:', JSON.stringify(cctv, null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
  }
}

run();
