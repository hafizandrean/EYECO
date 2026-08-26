import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = 'mongodb+srv://boltxa_db_user:eyeco123@eyeco.2arkt.j6.mongodb.net/eyeco?retryWrites=true&w=majority';
}

import { connectDB } from '../src/database/db';
import { CctvModel } from '../src/database/models/Cctv';

async function inspectCctv() {
  await connectDB();
  const cams = await CctvModel.find({}).lean().exec();
  console.log(`\nFound ${cams.length} CCTV documents in database:`);
  for (const c of cams) {
    console.log(`\nID: ${c.id} | Name: ${c.name} | Vendor: ${c.vendor} | Protocol: ${c.protocol}`);
    console.log(`  streamUrl: ${c.streamUrl}`);
    console.log(`  playUrl  : ${c.playUrl}`);
    console.log(`  desc     : ${c.description}`);
    console.log(`  tuyaAccId: ${c.tuyaAccessId || c.username || 'DEFAULT'}`);
  }
  process.exit(0);
}

inspectCctv().catch(err => {
  console.error(err);
  process.exit(1);
});
