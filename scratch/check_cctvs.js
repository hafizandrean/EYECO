const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to DB");

  const db = mongoose.connection.db;
  
  // Print all cameras in DB
  const cctvs = await db.collection('cctvs').find().toArray();
  cctvs.forEach(c => {
    console.log(`ID: ${c.id}, Name: ${c.name}, Vendor: ${c.vendor}, WorkspaceId: ${c.workspaceId}`);
  });

  await mongoose.connection.close();
}

run().catch(console.error);
