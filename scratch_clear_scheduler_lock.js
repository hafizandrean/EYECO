require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/eyeco';
  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB Connected');
    
    const SystemSettingsModel = mongoose.model('SystemSettings', new mongoose.Schema({}, { strict: false }), 'systemsettings');
    const lock = await SystemSettingsModel.findOne({ key: 'scheduler.lock' }).lean().exec();
    console.log('Current scheduler lock:', lock);
    
    if (lock) {
      console.log('Resetting lock status...');
      await SystemSettingsModel.updateOne(
        { key: 'scheduler.lock' },
        { 
          $set: { 
            'value.locked': false,
            'value.expiresAt': new Date(0)
          } 
        }
      );
      console.log('Lock status reset successfully.');
    } else {
      console.log('No lock settings document found.');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
