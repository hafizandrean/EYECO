import mongoose from 'mongoose';
import { CctvAutoReportService } from './src/cctv/services/CctvAutoReportService';
import { InferenceQueue } from './src/cctv/services/InferenceQueue';
import { CctvModel } from './src/database/models/Cctv';

async function testAutoReport() {
  await mongoose.connect('mongodb://localhost:27017/eyeco'); // Adjust URL if needed
  
  const camera = await CctvModel.findOne({}).exec();
  if (!camera) {
    console.log('No camera found');
    process.exit(1);
  }

  console.log('Testing camera:', camera.id, camera.location);
  
  // Fake detection
  const detection = {
    id: 9999,
    severity: 'LOW',
    detections: [
      { class: 'botol plastik', confidence: 0.8, bbox: [0,0,100,100] }
    ]
  };

  const frame = {
    cameraId: camera.id,
    imagePath: 'public/uploads/test.jpg',
    timestamp: new Date(),
    location: camera.location,
    streamUrl: camera.streamUrl || ''
  };

  try {
    const res = await CctvAutoReportService.processDetection(frame, detection as any);
    console.log('Result:', res);
  } catch (err) {
    console.error('Error testing auto report:', err);
  }
  
  process.exit(0);
}

testAutoReport();
