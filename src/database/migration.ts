import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { UserModel } from './models/User';
import { ReportModel } from './models/Report';
import { TimelineEventModel } from './models/TimelineEvent';

const DB_PATH = path.join(__dirname, 'db.json');
const BACKUP_PATH = path.join(__dirname, 'db.backup.json');

export async function runMigration() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[MIGRATION INFO] db.json not found, skipping migration.');
    return;
  }

  let rawData: string;
  try {
    rawData = fs.readFileSync(DB_PATH, 'utf-8');
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to read db.json:', err);
    return;
  }

  let dbData: { users?: any[]; reports?: any[] };
  try {
    dbData = JSON.parse(rawData);
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to parse db.json:', err);
    return;
  }

  const usersToMigrate = dbData.users || [];
  const reportsToMigrate = dbData.reports || [];

  if (usersToMigrate.length === 0 && reportsToMigrate.length === 0) {
    console.log('[MIGRATION INFO] db.json is empty, skipping migration.');
    return;
  }

  // Backup db.json
  try {
    fs.writeFileSync(BACKUP_PATH, rawData, 'utf-8');
    console.log(`[MIGRATION INFO] Backup created successfully at ${BACKUP_PATH}`);
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to create backup, aborting migration for safety:', err);
    return;
  }

  try {
    const userCount = await UserModel.countDocuments();
    const reportCount = await ReportModel.countDocuments();

    if (userCount > 0 || reportCount > 0) {
      console.log('[MIGRATION INFO] Database already has data. Skipping migration to prevent overwrite/duplicates.');
      return;
    }
  } catch (err) {
    console.error('[MIGRATION ERROR] Failed to query existing documents count:', err);
    return;
  }

  console.log(`[MIGRATION INFO] Found ${usersToMigrate.length} users and ${reportsToMigrate.length} reports in db.json to migrate.`);

  // Prepare user docs
  const userDocs = usersToMigrate.map(u => ({
    id: u.id,
    username: u.username.toLowerCase(),
    passwordHash: u.passwordHash,
    role: u.username === 'admin' ? 'admin' : u.role,
    name: u.username === 'admin' ? 'Administrator Utama' : u.username === 'user' ? 'Citizen Reporter' : 'Pengguna',
    email: `${u.username}@eyeco.gov.id`,
    agency: u.username === 'admin' ? 'EYECO Command Center' : 'Masyarakat Umum'
  }));

  // Add new simulation users for Enterprise Multi-Role demo
  const simulationUsers = [
    {
      id: 4,
      username: 'hafiz',
      passwordHash: '240eb518361bcf7061919cfdec98f98d7b328a6fcf4a3a60c0429f526279f647', // admin123
      role: 'operator',
      name: 'Hafiz Andrean',
      email: 'hafiz@eyeco.gov.id',
      agency: 'BBWS Ciliwung'
    },
    {
      id: 5,
      username: 'budi',
      passwordHash: '240eb518361bcf7061919cfdec98f98d7b328a6fcf4a3a60c0429f526279f647', // admin123
      role: 'supervisor',
      name: 'Budi Santoso',
      email: 'budi@eyeco.gov.id',
      agency: 'BBWS Pusat'
    },
    {
      id: 6,
      username: 'andre',
      passwordHash: '0b0213d2f9e414c81a5c68ad1d5f2a1b9487c679237071e6ad650041d8e13636', // user123
      role: 'officer',
      name: 'Andre Saputra',
      email: 'andre@eyeco.gov.id',
      agency: 'DLH Jakarta Selatan'
    }
  ];
  userDocs.push(...simulationUsers as any);

  // Helper mapping and insertion function
  const executeMigration = async (session?: mongoose.mongo.ClientSession) => {
    // 1. Insert Users
    const options = session ? { session } : {};
    const insertedUsers = await UserModel.insertMany(userDocs, options);
    
    // 2. Map integer ID to ObjectId
    const idMap = new Map<number, mongoose.Types.ObjectId>();
    insertedUsers.forEach(u => idMap.set(u.id, u._id as mongoose.Types.ObjectId));

    // 3. Prepare Report documents with ObjectIds and SLA details
    const reportDocs = reportsToMigrate.map(r => {
      const userObjectId = idMap.get(r.userId) || idMap.get(1); // default to admin if not found

      // Map status
      let mappedStatus: 'NEW' | 'UNDER_REVIEW' | 'VALIDATED' | 'ASSIGNED' | 'ON_SITE' | 'IN_PROGRESS' | 'RESOLVED' | 'WAITING_APPROVAL' | 'CLOSED' | 'REJECTED' = 'NEW';
      if (r.adminStatus === 'VALID') {
        mappedStatus = 'VALIDATED';
        if (r.status === 'PROSES') mappedStatus = 'IN_PROGRESS';
        if (r.status === 'SELESAI') mappedStatus = 'RESOLVED';
        if (r.status === 'CLOSED') mappedStatus = 'CLOSED';
      } else if (r.adminStatus === 'DIABAIKAN') {
        mappedStatus = 'REJECTED';
      } else {
        mappedStatus = 'UNDER_REVIEW';
      }

      // Generate SLA timeline dates
      const detectedAt = new Date(r.timestamp);
      const validatedAt = r.adminStatus === 'VALID' ? new Date(detectedAt.getTime() + 10 * 60 * 1000) : null;
      const assignedAt = (r.status === 'PROSES' || r.status === 'SELESAI' || r.status === 'CLOSED') ? new Date(detectedAt.getTime() + 15 * 60 * 1000) : null;
      const arrivedAt = (r.status === 'PROSES' || r.status === 'SELESAI' || r.status === 'CLOSED') ? new Date(detectedAt.getTime() + 25 * 60 * 1000) : null;
      const resolvedAt = (r.status === 'SELESAI' || r.status === 'CLOSED') ? new Date(detectedAt.getTime() + 60 * 60 * 1000) : null;
      const closedAt = r.status === 'CLOSED' ? new Date(detectedAt.getTime() + 90 * 60 * 1000) : null;

      // Calculate durations
      const validationDurationMs = validatedAt ? (validatedAt.getTime() - detectedAt.getTime()) : null;
      const assignmentDurationMs = (assignedAt && validatedAt) ? (assignedAt.getTime() - validatedAt.getTime()) : null;
      const cleanupDurationMs = (resolvedAt && arrivedAt) ? (resolvedAt.getTime() - arrivedAt.getTime()) : null;
      const resolutionDurationMs = (resolvedAt && assignedAt) ? (resolvedAt.getTime() - assignedAt.getTime()) : null;
      const totalDurationMs = closedAt ? (closedAt.getTime() - detectedAt.getTime()) : null;

      return {
        id: r.id,
        userId: userObjectId,
        tenantId: 'BBWS',
        location: r.location,
        timestamp: detectedAt,
        aiStatus: r.aiStatus,
        aiConfidence: r.aiConfidence,
        adminStatus: r.adminStatus,
        image: r.image,
        identity: r.identity,
        sourceType: r.sourceType,
        additionalNotes: r.additionalNotes,
        adminNotes: r.adminNotes,
        boundingBoxes: r.boundingBoxes || [],
        status: mappedStatus,
        currentAssignmentId: null,
        currentResolutionId: null,
        sla: {
          detectedAt,
          validatedAt,
          assignedAt,
          arrivedAt,
          resolvedAt,
          closedAt,
          validationDurationMs,
          assignmentDurationMs,
          cleanupDurationMs,
          resolutionDurationMs,
          totalDurationMs
        }
      };
    });

    const insertedReports = await ReportModel.insertMany(reportDocs, options);

    // 4. Generate Timeline Events for each report to seed immutable logs
    const timelineEvents: any[] = [];
    insertedReports.forEach(r => {
      // Detection Event
      timelineEvents.push({
        reportId: r._id,
        eventVersion: 1,
        type: 'DETECTION',
        actorId: idMap.get(1), // default admin
        actorName: 'YOLOv8',
        actorRole: 'AI',
        title: 'Deteksi AI',
        description: `Sistem mendeteksi ancaman dengan status ${r.aiStatus} di ${r.location}.`,
        metadata: { confidence: r.aiConfidence || 85, camera: 'CCTV-' + r.id },
        requestId: 'req_init_' + r.id,
        traceId: 'tr_init_' + r.id,
        correlationId: 'corr_' + r.id,
        ipAddress: '127.0.0.1',
        userAgent: 'EYECO System Scanner',
        createdAt: r.sla.detectedAt
      });

      // Review Event
      timelineEvents.push({
        reportId: r._id,
        eventVersion: 1,
        type: 'REVIEW',
        actorId: idMap.get(1),
        actorName: 'System',
        actorRole: 'AI',
        title: 'Tinjauan Antrean',
        description: 'Laporan masuk antrean verifikasi operator.',
        metadata: {},
        requestId: 'req_init_' + r.id,
        traceId: 'tr_init_' + r.id,
        correlationId: 'corr_' + r.id,
        ipAddress: '127.0.0.1',
        userAgent: 'EYECO System Scanner',
        createdAt: r.sla.detectedAt
      });

      // Validated / Rejected Event
      if (r.sla.validatedAt) {
        const isRejected = r.status === 'REJECTED';
        timelineEvents.push({
          reportId: r._id,
          eventVersion: 1,
          type: isRejected ? 'REJECTED' : 'VALIDATED',
          actorId: idMap.get(4), // Operator Hafiz
          actorName: 'Hafiz Andrean',
          actorRole: 'operator',
          title: isRejected ? 'Laporan Diabaikan' : 'Validasi Berhasil',
          description: isRejected ? 'Laporan ditolak oleh operator (Abaikan).' : 'Laporan disetujui untuk tindakan lanjutan.',
          metadata: { notes: r.adminNotes || '' },
          requestId: 'req_val_' + r.id,
          traceId: 'tr_val_' + r.id,
          correlationId: 'corr_' + r.id,
          ipAddress: '192.168.1.10',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          createdAt: r.sla.validatedAt
        });
      }

      // Assigned Event
      if (r.sla.assignedAt) {
        timelineEvents.push({
          reportId: r._id,
          eventVersion: 1,
          type: 'ASSIGNED',
          actorId: idMap.get(4), // Operator Hafiz
          actorName: 'Hafiz Andrean',
          actorRole: 'operator',
          title: 'Petugas Ditunjuk',
          description: `Menugaskan penanganan kepada Andre Saputra (DLH Jakarta Selatan).`,
          metadata: { officerId: idMap.get(6), officerName: 'Andre Saputra', agency: 'DLH Jakarta Selatan' },
          requestId: 'req_asn_' + r.id,
          traceId: 'tr_asn_' + r.id,
          correlationId: 'corr_' + r.id,
          ipAddress: '192.168.1.10',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          createdAt: r.sla.assignedAt
        });
      }

      // Arrived Event
      if (r.sla.arrivedAt) {
        timelineEvents.push({
          reportId: r._id,
          eventVersion: 1,
          type: 'ARRIVED',
          actorId: idMap.get(6), // Officer Andre
          actorName: 'Andre Saputra',
          actorRole: 'officer',
          title: 'Petugas Tiba',
          description: 'Petugas tiba di lokasi dan memulai penanganan.',
          metadata: {},
          requestId: 'req_arr_' + r.id,
          traceId: 'tr_arr_' + r.id,
          correlationId: 'corr_' + r.id,
          ipAddress: '10.0.2.15',
          userAgent: 'Android EYECO App v1.0',
          createdAt: r.sla.arrivedAt
        });
      }

      // Resolved Event
      if (r.sla.resolvedAt) {
        timelineEvents.push({
          reportId: r._id,
          eventVersion: 1,
          type: 'RESOLVED',
          actorId: idMap.get(6),
          actorName: 'Andre Saputra',
          actorRole: 'officer',
          title: 'Pembersihan Selesai',
          description: 'Sampah selesai dibersihkan. Mengajukan approval ke supervisor.',
          metadata: { notes: 'Sampah seberat 2.5 ton berhasil diangkut ke TPA.' },
          requestId: 'req_res_' + r.id,
          traceId: 'tr_res_' + r.id,
          correlationId: 'corr_' + r.id,
          ipAddress: '10.0.2.15',
          userAgent: 'Android EYECO App v1.0',
          createdAt: r.sla.resolvedAt
        });
      }

      // Closed Event
      if (r.sla.closedAt) {
        timelineEvents.push({
          reportId: r._id,
          eventVersion: 1,
          type: 'CLOSED',
          actorId: idMap.get(5), // Supervisor Budi
          actorName: 'Budi Santoso',
          actorRole: 'supervisor',
          title: 'Kasus Ditutup',
          description: 'Supervisor menyetujui hasil pembersihan. Kasus ditutup.',
          metadata: {},
          requestId: 'req_cls_' + r.id,
          traceId: 'tr_cls_' + r.id,
          correlationId: 'corr_' + r.id,
          ipAddress: '192.168.1.12',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          createdAt: r.sla.closedAt
        });
      }
    });

    if (timelineEvents.length > 0) {
      await TimelineEventModel.insertMany(timelineEvents, options);
    }
  };

  // Attempt transaction
  let session: mongoose.mongo.ClientSession | null = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    await executeMigration(session);

    await session.commitTransaction();
    console.log(`[MIGRATION SUCCESS] Transactional migration succeeded.`);
  } catch (err: any) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {}
    }
    
    // Check if it's transaction/session error (like standalone MongoDB deployment)
    const isSessionError = err.message && (
      err.message.includes('transaction') || 
      err.message.includes('session') ||
      err.codeName === 'InvalidOptions'
    );

    if (isSessionError) {
      console.warn('[MIGRATION WARNING] Sessions not supported. Falling back to non-transactional migration.');
      try {
        await executeMigration();
        console.log(`[MIGRATION SUCCESS] Fallback migration succeeded.`);
      } catch (fallbackErr) {
        console.error('[MIGRATION ERROR] Fallback migration failed:', fallbackErr);
      }
    } else {
      console.error('[MIGRATION ERROR] Transactional migration failed:', err);
    }
  } finally {
    if (session) {
      session.endSession();
    }
  }
}

