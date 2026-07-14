const mongoose = require('mongoose');
require('dotenv').config();

const SystemSettingsSchema = new mongoose.Schema({
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true }
}, { collection: 'systemsettings' });

const SystemSettingsModel = mongoose.model('SystemSettings', SystemSettingsSchema);

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/eyeco';
  console.log('Connecting to:', mongoUri);
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  const settings = await SystemSettingsModel.find({});
  console.log('All Settings:');
  for (const s of settings) {
    console.log(`- ${s.key}: ${JSON.stringify(s.value)} (Type: ${typeof s.value})`);
  }

  await mongoose.connection.close();
}

main().catch(console.error);
