import dotenv from 'dotenv';
dotenv.config();

import { TuyaCloudService } from '../src/cctv/TuyaCloudService';

async function testTuya() {
  const accessId = 'vhxcdfe5q7d5vr4wsgs3';
  const accessSecret = '0757b40d43884b83952b3b306814fba9';
  const deviceId = 'a38ba18bd97cf81f7brasa';
  const region = 'US'; // Could be US, EU, SG, etc. Defaulting to SG/US. Tuya Project code might imply region.

  try {
    console.log('Validating credentials...');
    const result = await TuyaCloudService.validateCredentials(accessId, accessSecret, region);
    console.log('Validation result:', result);

    if (result.ok) {
        console.log('Getting stream URL...');
        const stream = await TuyaCloudService.getStreamUrl(accessId, accessSecret, deviceId, region);
        console.log('Stream URL:', stream);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

testTuya();
