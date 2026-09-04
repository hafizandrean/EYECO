/**
 * Simulasi persis alur yang dilakukan backend HLS proxy
 * Jalankan: npx ts-node scripts/test-tuya-stream.ts
 */
import { TuyaClient } from '../src/cctv/services/TuyaClient';
import { connectDB } from '../src/database/db';
import { CctvModel } from '../src/database/models/Cctv';
import * as dotenv from 'dotenv';
dotenv.config();

async function main() {
  await connectDB();
  
  const cameraId = 'a34008d066e4497aaeg9yw'; // Outdoor Camera Solar
  
  const accessId = process.env.TUYA_CLIENT_ID!;
  const accessSecret = process.env.TUYA_CLIENT_SECRET!;
  const endpoint = process.env.TUYA_API_ENDPOINT || 'https://openapi-sg.iotbing.com';
  
  console.log('\n=== SIMULASI HLS PROXY BACKEND ===');
  console.log(`Access ID: ${accessId}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Camera ID: ${cameraId}\n`);

  // Step 1: Cari dokumen kamera di DB
  const camDoc = await CctvModel.findOne({
    $or: [
      { id: isNaN(Number(cameraId)) ? -999 : Number(cameraId) },
      { username: cameraId },
      { description: { $regex: cameraId } }
    ]
  }).lean();
  
  console.log(`[1] DB lookup: ${camDoc ? `Found (id=${camDoc.id}, vendor=${camDoc.vendor})` : 'NOT FOUND'}`);
  if (camDoc) {
    console.log(`    description: ${camDoc.description}`);
    console.log(`    streamUrl: ${camDoc.streamUrl}`);
  }

  // Step 2: Ekstrak tuyaDeviceId
  let tuyaDeviceId = cameraId;
  if (camDoc?.description) {
    const tuyaIdMatch = camDoc.description.match(/Tuya Device ID[:\s]+([a-zA-Z0-9]+)/);
    const vidMatch = camDoc.description.match(/Virtual ID[:\s]+([a-zA-Z0-9]+)/);
    if (tuyaIdMatch?.[1]) tuyaDeviceId = tuyaIdMatch[1];
    else if (vidMatch?.[1]) tuyaDeviceId = vidMatch[1];
  }
  if (tuyaDeviceId === cameraId && camDoc?.streamUrl) {
    const m = camDoc.streamUrl.match(/\/hls-proxy\/([a-zA-Z0-9]+)\//);
    if (m?.[1] && m[1].length > 10) tuyaDeviceId = m[1];
  }
  console.log(`\n[2] tuyaDeviceId: ${tuyaDeviceId}`);

  // Step 3: Auth
  const client = new TuyaClient(accessId, accessSecret, endpoint);
  console.log('\n[3] getAccessToken...');
  try {
    await client.getAccessToken();
    console.log('    ✅ Token OK');
  } catch (e: any) {
    console.error(`    ❌ GAGAL: ${e.message}`);
    process.exit(1);
  }

  // Step 4: getStreamUrl HLS
  console.log('\n[4] getStreamUrl HLS...');
  let streamUrl = '';
  try {
    streamUrl = await client.getStreamUrl(tuyaDeviceId, 'HLS');
    console.log(`    ✅ HLS URL: ${streamUrl}`);
  } catch (e: any) {
    console.error(`    ❌ GAGAL: ${e.message}`);
  }

  // Step 5: Fetch manifest dari Tuya CDN
  if (streamUrl) {
    console.log('\n[5] Fetch manifest dari Tuya CDN...');
    try {
      const r = await fetch(streamUrl);
      const text = await r.text();
      console.log(`    HTTP Status: ${r.status}`);
      console.log(`    Content-Type: ${r.headers.get('content-type')}`);
      console.log(`    Body preview: ${text.substring(0, 200)}`);
      
      if (r.ok && text.includes('#EXT')) {
        console.log('\n    ✅ Manifest valid! HLS proxy akan berhasil.');
      } else if (text.includes('session not found') || text.includes('Not Found')) {
        console.log('\n    ❌ Session expired atau tidak valid. Perlu allocate fresh URL.');
        
        // Coba fresh URL
        console.log('\n[5b] Mencoba allocate fresh HLS URL...');
        const freshUrl = await client.getStreamUrl(tuyaDeviceId, 'HLS', true);
        console.log(`    Fresh URL: ${freshUrl}`);
        const r2 = await fetch(freshUrl);
        const text2 = await r2.text();
        console.log(`    Status: ${r2.status}`);
        console.log(`    Body: ${text2.substring(0, 200)}`);
      } else {
        console.log('\n    ❌ Manifest tidak valid.');
      }
    } catch (e: any) {
      console.error(`    ❌ Fetch gagal: ${e.message}`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
