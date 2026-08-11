// R2 verify dengan endpoint + creds dari dashboard baru — upload real ke eyeco
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
require('dotenv').config({ path: '/Users/karim/Tugas/JS/eyeco/.env' });

const ENDPOINT = 'https://5ee84d3e34db17dd27224efe43e8ad61.r2.cloudflarestorage.com';
const BUCKET = 'eyeco';
const AK = process.env.R2_ACCESS_KEY_ID;
const SK = process.env.R2_SECRET_ACCESS_KEY;
console.log('CRED_OK', Boolean(AK && SK), 'bucket_env=', process.env.R2_BUCKET);

const client = new S3Client({
  region: 'auto',
  endpoint: ENDPOINT,
  credentials: { accessKeyId: AK, secretAccessKey: SK },
  forcePathStyle: true,
});

(async () => {
  const probe = '__probe_' + Date.now() + '.txt';
  try {
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: 'laporan_manual/' + probe, Body: 'probe', ContentType: 'text/plain' }));
    console.log('PUT_OK laporan_manual/' + probe);
  } catch (e) { console.log('PUT_ERR', e.name, e.message.slice(0, 160)); }

  try {
    const l = await client.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 30 }));
    console.log('KEYS:', (l.Contents || []).map(o => o.Key).join(' | '));
  } catch (e) { console.log('LIST_ERR', e.name, e.message.slice(0, 160)); }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: 'laporan_manual/' + probe }));
    console.log('CLEANUP_OK');
  } catch (e) { console.log('CLEANUP_ERR', e.message.slice(0, 100)); }
})();