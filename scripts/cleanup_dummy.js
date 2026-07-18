/**
 * Cleanup Dummy Data — Hapus report dummy, retain user-uploaded reports.
 * 
 * Dummy reports indentifikasi: 
 * 1. identity = null / tidak ada field identity
 * 2. userId bukan milik user aktif (panjulspion userId = 6)
 * 3. Atau report tanpa komentar/interaksi user
 * 
 * Tapi cara paling aman: retain 15 report yg sudah teridentifikasi
 * dari API /detections (user panjulspion hanya lihat 15).
 *
 * Catatan: Script ini harus dijalankan di server context (koneksi mongoose
 * harus match dengan server yang sedang berjalan).
 */

const mongoose = require('mongoose');
const path = require('path');

// Load env dengan path yg benar
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const USER_REPORT_IDS = [
  1305, 1419, 1425, 2770, 2895, 2896, 2897, 2898, 2899, 
  2900, 2901, 2902, 2903, 2904, 2905
];

async function cleanup() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const reportsCol = db.collection('reports');
    const cctvCol = db.collection('cctvchannels');

    // Hitung total
    const total = await reportsCol.countDocuments();
    console.log(`Total reports before cleanup: ${total}`);

    // Hapus report yg TIDAK ada di USER_REPORT_IDS
    // Gunakan field 'id' (integer)
    const deleteResult = await reportsCol.deleteMany({
      id: { $nin: USER_REPORT_IDS }
    });
    console.log(`Deleted ${deleteResult.deletedCount} dummy reports`);

    // Verifikasi
    const remaining = await reportsCol.countDocuments();
    console.log(`Remaining reports: ${remaining}`);

    // Cek CCTV
    const cctvCount = await cctvCol.countDocuments();
    console.log(`CCTV channels: ${cctvCount}`);
    
    if (cctvCount > 0) {
      const cctvResult = await cctvCol.deleteMany({});
      console.log(`Deleted ${cctvResult.deletedCount} CCTV channels`);
    }

    console.log('\nCleanup selesai!');
    await mongoose.disconnect();
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  }
}

cleanup();
