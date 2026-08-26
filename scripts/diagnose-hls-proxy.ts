import dotenv from 'dotenv';
import path from 'path';
import { TuyaClient } from '../src/cctv/services/TuyaClient';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function diagnoseHlsProxy() {
  console.log(`\n======================================================`);
  console.log(`  DEEP DIAGNOSIS FOR /api/cctv/hls-proxy/:id/stream.m3u8`);
  console.log(`======================================================\n`);

  const devId = 'a364596d73c1ec2a23elei';
  const accessId = process.env.TUYA_CLIENT_ID || 'vhxcdfe5q7d5vr4wsgs3';
  const accessSecret = process.env.TUYA_CLIENT_SECRET || '0757b40d43884h83952b3b306814fba9';
  const endpoint = process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com';

  console.log(`Target Device ID: ${devId}`);
  console.log(`Tuya Endpoint   : ${endpoint}`);
  console.log(`Client ID       : ${accessId}\n`);

  const client = new TuyaClient(accessId, accessSecret, endpoint);
  try {
    const token = await client.getAccessToken();
    console.log(`✓ Access token obtained successfully: ${token.slice(0, 15)}...`);
  } catch (err: any) {
    console.error(`❌ Access token error:`, err.message);
    process.exit(1);
  }

  // Test 1: Allocate HLS stream from Tuya Cloud
  console.log(`\n[TEST 1] Calling Tuya Cloud for HLS stream allocation...`);
  try {
    const hlsUrl = await client.getStreamUrl(devId, 'HLS', true);
    console.log(`✓ [HLS URL RECEIVED] ${hlsUrl}`);
    if (hlsUrl.startsWith('http')) {
      const res = await fetch(hlsUrl);
      const text = await res.text();
      console.log(`  HLS Manifest HTTP Status: ${res.status}`);
      console.log(`  HLS Manifest Content snippet:\n  ${text.slice(0, 200).replace(/\n/g, '\n  ')}`);
    }
  } catch (err: any) {
    console.error(`❌ [HLS ERROR]:`, err.message);
  }

  // Test 2: Allocate RTSP stream from Tuya Cloud
  console.log(`\n[TEST 2] Calling Tuya Cloud for RTSP stream allocation...`);
  try {
    const rtspUrl = await client.getStreamUrl(devId, 'RTSP', true);
    console.log(`✓ [RTSP URL RECEIVED] ${rtspUrl}`);
  } catch (err: any) {
    console.error(`❌ [RTSP ERROR]:`, err.message);
  }

  process.exit(0);
}

diagnoseHlsProxy().catch(err => {
  console.error(err);
  process.exit(1);
});
