import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const ALLOWED_LEGACY_DATABASES = [
  'test',
  'eyeco_db',
  'sample_mflix'
];

const FORBIDDEN_DATABASES = ['eyeco', 'admin', 'local', 'config'];

function buildDbUri(rawUri: string, dbName: string): string {
  const parsed = new URL(rawUri);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

async function runCleanup() {
  const args = process.argv.slice(2);
  const isConfirm = args.includes('--confirm');
  const expectedTargetArg = args.find(a => a.startsWith('--expected-target='));
  const expectedTarget = expectedTargetArg ? expectedTargetArg.split('=')[1] : null;

  console.log(`\n======================================================`);
  console.log(`  EYECO LEGACY DATABASE CLEANUP SCRIPT`);
  console.log(`  MODE: ${isConfirm ? 'EXECUTE (DESTRUCTIVE)' : 'DRY-RUN (READ-ONLY SIMULATION)'}`);
  console.log(`======================================================\n`);

  if (isConfirm && expectedTarget !== 'eyeco') {
    console.error(`❌ SAFETY LOCK BLOCKED: You must supply '--expected-target=eyeco' alongside '--confirm'.`);
    console.error(`Example: npx tsx scripts/cleanup-legacy-databases.ts --confirm --expected-target=eyeco\n`);
    process.exit(1);
  }

  const rawUri = process.env.MONGODB_URI;
  if (!rawUri) {
    console.error('ERROR: MONGODB_URI is not defined in .env');
    process.exit(1);
  }

  const rootUri = buildDbUri(rawUri, 'admin');
  const conn = await mongoose.createConnection(rootUri).asPromise();
  const adminDb = conn.db!.admin();

  const { databases } = await adminDb.listDatabases();
  const dbNames = databases.map((d: any) => d.name);

  console.log(`All databases in cluster: ${dbNames.join(', ')}\n`);

  const dbsToDelete: string[] = [];

  for (const name of dbNames) {
    if (FORBIDDEN_DATABASES.includes(name)) {
      console.log(`  [PROTECTED] Skipping protected database '${name}'`);
      continue;
    }

    if (ALLOWED_LEGACY_DATABASES.includes(name) || name.startsWith('eyeco_phase6j_test_')) {
      dbsToDelete.push(name);
    } else {
      console.log(`  [SKIP] Skipping un-whitelisted database '${name}'`);
    }
  }

  console.log(`\nDatabases identified for cleanup: [${dbsToDelete.join(', ')}]\n`);

  if (!isConfirm) {
    console.log(`======================================================`);
    console.log(`  DRY-RUN COMPLETED — NO DATABASES WERE DELETED.`);
    console.log(`  To execute deletion, run:`);
    console.log(`  npx tsx scripts/cleanup-legacy-databases.ts --confirm --expected-target=eyeco`);
    console.log(`======================================================\n`);
    await conn.close();
    process.exit(0);
  }

  console.log(`⚠️  STARTING DESTRUCTIVE DATABASE DELETION IN 3 SECONDS...`);
  await new Promise(r => setTimeout(r, 3000));

  for (const dbName of dbsToDelete) {
    if (FORBIDDEN_DATABASES.includes(dbName)) {
      console.error(`❌ SAFETY LOCK HIT: Hardcoded refusal to drop '${dbName}'.`);
      continue;
    }
    console.log(`Dropping legacy database '${dbName}'...`);
    const dbConn = await mongoose.createConnection(buildDbUri(rawUri, dbName)).asPromise();
    await dbConn.db!.dropDatabase();
    await dbConn.close();
    console.log(`✓ Dropped database '${dbName}' successfully.`);
  }

  console.log(`\n======================================================`);
  console.log(`  CLEANUP COMPLETED SUCCESSFULLY.`);
  console.log(`======================================================\n`);

  await conn.close();
  process.exit(0);
}

runCleanup().catch(err => {
  console.error('Cleanup Failed:', err);
  process.exit(1);
});
