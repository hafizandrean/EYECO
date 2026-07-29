import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { CctvModel } from '../src/database/models/Cctv';

async function addCamera() {
  await mongoose.connect(process.env.MONGODB_URI || '');
  console.log('Connected to DB');

  try {
    const accessId = 'vhxcdfe5q7d5vr4wsgs3';
    const accessSecret = '0757b40d43884b83952b3b306814fba9';
    const deviceId = 'a38ba18bd97cf81f7brasa';
    const region = 'US'; // Just using US/SG endpoint

    const maxCctv = await CctvModel.findOne({}).sort({ id: -1 });
    const nextId = maxCctv ? maxCctv.id + 1 : 1;

    // We store the device ID in streamUrl so CctvAdapter knows what to stream, or use tuya://
    // The CctvScanner.ts does: streamUrl = `tuya://${username}/${password}`; 
    // And TuyaCloudService requires deviceId. Wait, how does Tuya video stream get the deviceId? 
    // The scanner in CctvScanner.ts sets streamUrl = `tuya://${username}/${password}`;
    // But it doesn't store the deviceId anywhere? 
    // Wait, let's just use `tuya://${accessId}/${accessSecret}` for streamUrl
    // Wait, without deviceId, how can it stream? It needs deviceId. 
    // Let's store deviceId in streamUrl: `tuya://${accessId}:${accessSecret}@${deviceId}`
    // Let's just insert it and check how the frontend uses it.

    const newCctv = new CctvModel({
        id: nextId,
        name: 'Tuya Camera Auto',
        location: 'Auto Location',
        description: 'Auto-added Tuya Camera',
        vendor: 'TUYA',
        model: 'Tuya Smart Camera',
        protocol: 'TUYA',
        mediaType: 'Cloud',
        streamUrl: `tuya://${accessId}/${accessSecret}/${deviceId}`,
        playUrl: `tuya://${accessId}/${accessSecret}/${deviceId}`,
        username: accessId,
        password: '', // Encrypted in real flow, but for Tuya it seems streamUrl holds it or we just leave empty for testing
        capabilities: {
            rtsp: false,
            hls: false,
            snapshot: false,
            mjpeg: false,
            onvif: false,
            cloud: true
        },
        status: 'ONLINE',
        health: { latency: 0, fps: 0, resolution: '1080p' },
        isDefault: false,
        isActive: true,
        monitoringEnabled: false,
        workspaceId: 1 // Assume admin workspace
    });
    
    await newCctv.save();
    console.log('Tuya Camera added successfully with ID:', nextId);
  } catch (error) {
    console.error('Error adding camera:', error);
  } finally {
    mongoose.disconnect();
  }
}

addCamera();
