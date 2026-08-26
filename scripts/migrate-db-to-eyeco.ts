import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const SOURCE_DB_NAME = 'test';
const TARGET_DB_NAME = 'eyeco';

function buildDbUri(rawUri: string, dbName: string): string {
  const parsed = new URL(rawUri);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

const PRIORITY_COLLECTIONS = [
  'users',
  'workspaces',
  'reports',
  'cctvs',
  'news',
  'systemsettings',
  'notifications',
  'systemauditlogs',
  'aisnapshots',
  'sessions',
  'counters',
  'joinrequests',
  'timelineevents',
  'modeltrainingjobs',
  'aivalidationlogs',
  'outboxevents',
  'aievidences',
  'aidetections',
  'aimetrics'
];

async function runMigration() {
  const isFinalSync = process.argv.includes('--final-sync');
  console.log(`\n======================================================`);
  console.log(`  EYECO MONGODB DOMAIN-FIRST MIGRATION SUITE`);
  console.log(`  MODE: ${isFinalSync ? 'FINAL DELTA SYNC (Cutover Mode)' : 'FAST FULL COPY'}`);
  console.log(`  SOURCE: ${SOURCE_DB_NAME}  --->  TARGET: ${TARGET_DB_NAME}`);
  console.log(`======================================================\n`);

  const rawUri = process.env.MONGODB_URI;
  if (!rawUri) {
    console.error('ERROR: MONGODB_URI is not defined in .env');
    process.exit(1);
  }

  const sourceUri = buildDbUri(rawUri, SOURCE_DB_NAME);
  const targetUri = buildDbUri(rawUri, TARGET_DB_NAME);

  console.log(`Connecting to Source Database (${SOURCE_DB_NAME})...`);
  const sourceConn = await mongoose.createConnection(sourceUri).asPromise();
  console.log(`Connecting to Target Database (${TARGET_DB_NAME})...`);
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  const sourceDb = sourceConn.db!;
  const targetDb = targetConn.db!;

  const collections = await sourceDb.listCollections().toArray();
  console.log(`Found ${collections.length} collections in source DB '${SOURCE_DB_NAME}'.\n`);

  collections.sort((a, b) => {
    const idxA = PRIORITY_COLLECTIONS.indexOf(a.name);
    const idxB = PRIORITY_COLLECTIONS.indexOf(b.name);
    const pA = idxA === -1 ? 50 : idxA;
    const pB = idxB === -1 ? 50 : idxB;
    return pA - pB;
  });

  let totalMigratedDocs = 0;
  let totalMigratedIndexes = 0;

  for (const colInfo of collections) {
    const colName = colInfo.name;
    if (colName.startsWith('system.')) continue;

    const sourceCol = sourceDb.collection(colName);
    const targetCol = targetDb.collection(colName);

    const sourceCount = await sourceCol.countDocuments();
    const targetCount = await targetCol.countDocuments();

    console.log(`Processing collection: [${colName}] (Source: ${sourceCount}, Target: ${targetCount})...`);

    // 1. Copy & Verify Indexes
    try {
      const sourceIndexes = await sourceCol.indexes();
      for (const idx of sourceIndexes) {
        if (idx.name === '_id_') continue;
        const key = idx.key;
        const options: any = {};
        if (idx.unique) options.unique = true;
        if (idx.name) options.name = idx.name;
        if (idx.sparse) options.sparse = true;
        if (idx.expireAfterSeconds !== undefined) options.expireAfterSeconds = idx.expireAfterSeconds;
        if (idx.partialFilterExpression) options.partialFilterExpression = idx.partialFilterExpression;
        if (idx.collation) options.collation = idx.collation;

        try {
          await targetCol.createIndex(key, options);
          totalMigratedIndexes++;
        } catch (idxErr: any) {
          if (!idxErr.message.includes('already exists')) {
            console.warn(`  [INDEX WARN] ${colName}.${idx.name}: ${idxErr.message}`);
          }
        }
      }
    } catch (_) {}

    // Skip if already matching
    if (sourceCount === targetCount && sourceCount > 0 && !isFinalSync) {
      console.log(`  ✓ ${colName} already matching (${targetCount}/${sourceCount} docs). Skipping.\n`);
      continue;
    }

    if (sourceCount === 0) {
      if (!isFinalSync) await targetCol.deleteMany({});
      console.log(`  ✓ ${colName}: Source is empty (0 docs).\n`);
      continue;
    }

    // Always clear target collection for full clean copy to avoid immutable _id conflict
    await targetCol.deleteMany({});

    // 2. Ultra Batch Copy
    const cursor = sourceCol.find({}).batchSize(2500);
    let count = 0;
    let batch: any[] = [];
    const batchSize = 2500;

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;

      batch.push(doc);
      count++;

      if (batch.length >= batchSize) {
        await targetCol.insertMany(batch, { ordered: false });
        totalMigratedDocs += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      await targetCol.insertMany(batch, { ordered: false });
      totalMigratedDocs += batch.length;
      batch = [];
    }

    const finalTargetCount = await targetCol.countDocuments();
    console.log(`  ✓ ${colName}: Copy completed (${count} processed, total in target: ${finalTargetCount})\n`);
  }

  console.log(`======================================================`);
  console.log(`  MIGRATION SUMMARY`);
  console.log(`======================================================`);
  console.log(`  Total Processed Documents : ${totalMigratedDocs}`);
  console.log(`  Total Indexes Processed   : ${totalMigratedIndexes}`);
  console.log(`  Target Database           : ${TARGET_DB_NAME}`);
  console.log(`  Source Database           : ${SOURCE_DB_NAME} (UNTOUCHED / PRESERVED)`);
  console.log(`======================================================\n`);

  await sourceConn.close();
  await targetConn.close();
  process.exit(0);
}

runMigration().catch((err) => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});
