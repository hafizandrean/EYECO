import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { R2StorageService } from '../src/services/R2StorageService';

dotenv.config();

async function migrateUploads() {
  console.log('=== Starting Uploads Migration to Cloudflare R2 ===');
  
  if (!R2StorageService.isConfigured()) {
    console.error('ERROR: Cloudflare R2 is not fully configured in .env (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY).');
    process.exit(1);
  }

  const uploadsDir = path.join(__dirname, '../public/uploads');
  if (!fs.existsSync(uploadsDir)) {
    console.log('No public/uploads directory found. Nothing to migrate.');
    return;
  }

  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.heic': 'image/heic'
  };

  function getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return mimeTypes[ext] || 'application/octet-stream';
  }

  let totalUploaded = 0;
  let totalErrors = 0;

  async function processDirectory(dirPath: string, relativeDir = '') {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      const relPath = path.join(relativeDir, item.name).replace(/\\/g, '/');

      if (item.isDirectory()) {
        await processDirectory(fullPath, relPath);
      } else if (item.isFile()) {
        // Skip dummy/gitkeep
        if (item.name === '.gitkeep' || item.name === '.DS_Store') continue;

        let r2Key = relPath;
        if (relPath.startsWith('berita/')) {
          r2Key = `eyecofiles/berita/${relPath.replace(/^berita\//, '')}`;
        } else if (relPath.startsWith('avatars/')) {
          r2Key = `eyecofiles/avatars/${relPath.replace(/^avatars\//, '')}`;
        } else if (relPath.startsWith('reports/')) {
          r2Key = `eyecofiles/laporan_manual/${relPath.replace(/^reports\//, '')}`;
        } else if (relPath.startsWith('laporan_manual/')) {
          r2Key = `eyecofiles/laporan_manual/${relPath.replace(/^laporan_manual\//, '')}`;
        } else if (relPath.startsWith('laporan_auto/')) {
          r2Key = `eyecofiles/laporan_auto/${relPath.replace(/^laporan_auto\//, '')}`;
        } else if (relPath.startsWith('news_')) {
          r2Key = `eyecofiles/berita/${relPath}`;
        } else if (relPath.startsWith('avatar_')) {
          r2Key = `eyecofiles/avatars/${relPath}`;
        } else if (relPath.startsWith('upload_')) {
          r2Key = `eyecofiles/laporan_manual/${relPath}`;
        } else if (relPath.startsWith('cctv_capture_') || relPath.startsWith('evidence_')) {
          r2Key = `eyecofiles/laporan_auto/${relPath}`;
        } else {
          r2Key = `eyecofiles/${relPath}`;
        }

        const contentType = getContentType(fullPath);
        try {
          console.log(`[R2 Uploading] ${relPath} -> ${r2Key} (${contentType})`);
          await R2StorageService.uploadFile(fullPath, r2Key, contentType, true);
          totalUploaded++;
        } catch (err: any) {
          console.error(`[R2 ERROR] Failed to upload ${relPath}:`, err.message);
          totalErrors++;
        }
      }
    }
  }

  await processDirectory(uploadsDir);
  console.log(`=== Migration Finished: ${totalUploaded} uploaded, ${totalErrors} failed ===`);
}

migrateUploads().catch(console.error);
