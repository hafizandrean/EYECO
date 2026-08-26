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

async function verifyMigration() {
  console.log(`\n======================================================`);
  console.log(`  EYECO MONGODB MIGRATION VERIFICATION SUITE`);
  console.log(`  VERIFYING: ${SOURCE_DB_NAME} ===> ${TARGET_DB_NAME}`);
  console.log(`======================================================\n`);

  const rawUri = process.env.MONGODB_URI;
  if (!rawUri) {
    console.error('ERROR: MONGODB_URI is not defined in .env');
    process.exit(1);
  }

  const sourceUri = buildDbUri(rawUri, SOURCE_DB_NAME);
  const targetUri = buildDbUri(rawUri, TARGET_DB_NAME);

  const sourceConn = await mongoose.createConnection(sourceUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  const sourceDb = sourceConn.db!;
  const targetDb = targetConn.db!;

  const sourceCols = await sourceDb.listCollections().toArray();
  const targetCols = await targetDb.listCollections().toArray();

  const targetColMap = new Map(targetCols.map(c => [c.name, c]));

  let overallPass = true;
  const results: Array<{
    colName: string;
    docCountMatch: boolean;
    sourceCount: number;
    targetCount: number;
    indexCountMatch: boolean;
    sourceIndexes: number;
    targetIndexes: number;
    idSampleMatch: boolean;
    referenceValid: boolean;
  }> = [];

  for (const sCol of sourceCols) {
    const colName = sCol.name;
    if (colName.startsWith('system.')) continue;

    const tColInfo = targetColMap.get(colName);
    if (!tColInfo) {
      console.error(`❌ [FAIL] Collection '${colName}' missing in target database '${TARGET_DB_NAME}'`);
      overallPass = false;
      continue;
    }

    const sourceCol = sourceDb.collection(colName);
    const targetCol = targetDb.collection(colName);

    const [sourceCount, targetCount] = await Promise.all([
      sourceCol.countDocuments(),
      targetCol.countDocuments(),
    ]);

    const docCountMatch = sourceCount === targetCount;
    if (!docCountMatch) overallPass = false;

    // Index Verification
    const [sourceIndexes, targetIndexes] = await Promise.all([
      sourceCol.indexes(),
      targetCol.indexes(),
    ]);

    const indexCountMatch = targetIndexes.length >= sourceIndexes.length;
    if (!indexCountMatch) overallPass = false;

    // Sample _id Verification
    const sampleSourceDocs = await sourceCol.find({}).limit(10).toArray();
    let idSampleMatch = true;
    for (const sDoc of sampleSourceDocs) {
      const tDoc = await targetCol.findOne({ _id: sDoc._id });
      if (!tDoc) {
        idSampleMatch = false;
        overallPass = false;
        break;
      }
    }

    // Foreign Key / Reference Verification for key collections
    let referenceValid = true;
    if (colName === 'reports') {
      const sampleReports = await targetCol.find({ userId: { $exists: true } }).limit(20).toArray();
      const usersCol = targetDb.collection('users');
      for (const r of sampleReports) {
        if (r.userId) {
          const userExists = await usersCol.findOne({ _id: r.userId });
          if (!userExists) {
            referenceValid = false;
            overallPass = false;
            console.warn(`  [REF WARN] Report #${r.id} references missing userId: ${r.userId}`);
          }
        }
      }
    }

    results.push({
      colName,
      docCountMatch,
      sourceCount,
      targetCount,
      indexCountMatch,
      sourceIndexes: sourceIndexes.length,
      targetIndexes: targetIndexes.length,
      idSampleMatch,
      referenceValid
    });
  }

  console.log(`-----------------------------------------------------------------------------------------`);
  console.log(`COLLECTION              | DOC MATCH    | SOURCE / TARGET   | INDEX MATCH | REF INTEGRITY`);
  console.log(`-----------------------------------------------------------------------------------------`);
  for (const r of results) {
    const docStatus = r.docCountMatch ? '✓ MATCH' : '❌ MISMATCH';
    const idxStatus = r.indexCountMatch ? '✓ MATCH' : '❌ MISMATCH';
    const refStatus = r.referenceValid ? '✓ VALID' : '❌ INVALID';
    console.log(
      `${r.colName.padEnd(23)} | ${docStatus.padEnd(12)} | ${String(r.sourceCount).padStart(6)} / ${String(r.targetCount).padStart(6)} | ${idxStatus.padEnd(11)} | ${refStatus}`
    );
  }
  console.log(`-----------------------------------------------------------------------------------------\n`);

  console.log(`======================================================`);
  console.log(`  VERIFICATION FINAL RESULT: ${overallPass ? '✅ PASS (MIGRATION FULLY VERIFIED)' : '❌ FAIL (INCONSISTENCIES FOUND)'}`);
  console.log(`======================================================\n`);

  await sourceConn.close();
  await targetConn.close();
  process.exit(overallPass ? 0 : 1);
}

verifyMigration().catch(err => {
  console.error('Verification Script Failed:', err);
  process.exit(1);
});
