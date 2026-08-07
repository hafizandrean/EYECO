"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminValidationFeedbackService = exports.AdminValidationFeedbackService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const AdminValidationEvent_1 = require("../../../database/models/AdminValidationEvent");
class AdminValidationFeedbackService {
    mapMlFeedbackRole(validationStatus, invalidReason) {
        if (validationStatus === 'VALID') {
            return 'CONFIRMED_POSITIVE';
        }
        switch (invalidReason) {
            case 'FALSE_POSITIVE':
                return 'NEGATIVE_EXAMPLE';
            case 'WRONG_OBJECT':
                return 'OBJECT_CORRECTION';
            case 'WRONG_ACTIVITY':
                return 'ACTIVITY_CORRECTION';
            case 'WRONG_CONTEXT':
                return 'CONTEXT_CORRECTION';
            case 'INSUFFICIENT_EVIDENCE':
                return 'EXCLUDED_FROM_TRAINING';
            case 'OTHER':
            default:
                return 'HUMAN_REVIEW_REQUIRED';
        }
    }
    getDisplayLabel(status) {
        const s = String(status || '').toUpperCase();
        if (s === 'VALID')
            return 'Valid';
        if (s === 'INVALID' || s === 'ABAIKAN' || s === 'DIABAIKAN' || s === 'IGNORED' || s === 'DISMISSED')
            return 'Tidak Valid';
        return 'Menunggu';
    }
    async recordAdminValidationFeedback(params) {
        const { reportId, snapshotId, previousValidationStatus, validationStatus, invalidReason, correctionPayload, validatedByUserId, idempotencyKey } = params;
        // 1. Strict Contract Validation Rules
        if (validationStatus !== 'VALID' && validationStatus !== 'INVALID') {
            const err = new Error(`VALIDATION_STATUS_INVALID: Status must be 'VALID' or 'INVALID', received '${validationStatus}'.`);
            err.status = 400;
            throw err;
        }
        if (validationStatus === 'VALID') {
            if (invalidReason !== null && invalidReason !== undefined) {
                const err = new Error('VALIDATION_CONTRACT_VIOLATION: VALID validation status MUST have null invalidReason.');
                err.status = 422;
                throw err;
            }
        }
        if (validationStatus === 'INVALID') {
            if (!invalidReason) {
                const err = new Error('VALIDATION_REASON_REQUIRED: INVALID validation status requires an invalidReason (FALSE_POSITIVE, WRONG_OBJECT, WRONG_ACTIVITY, WRONG_CONTEXT, INSUFFICIENT_EVIDENCE, OTHER).');
                err.status = 422;
                throw err;
            }
            const allowedReasons = [
                'FALSE_POSITIVE',
                'WRONG_OBJECT',
                'WRONG_ACTIVITY',
                'WRONG_CONTEXT',
                'INSUFFICIENT_EVIDENCE',
                'OTHER'
            ];
            if (!allowedReasons.includes(invalidReason)) {
                const err = new Error(`INVALID_REASON_UNRECOGNIZED: Unrecognized invalidReason '${invalidReason}'.`);
                err.status = 400;
                throw err;
            }
        }
        // 2. Compute Payload Hash & ML Feedback Role
        const mlFeedbackRole = this.mapMlFeedbackRole(validationStatus, invalidReason);
        const payloadToHash = {
            reportId,
            snapshotId: snapshotId ? String(snapshotId) : null,
            previousValidationStatus,
            validationStatus,
            invalidReason: invalidReason || null,
            correctionPayload: correctionPayload || null,
            validatedByUserId: String(validatedByUserId),
            idempotencyKey
        };
        const payloadHash = crypto_1.default.createHash('sha256').update(JSON.stringify(payloadToHash)).digest('hex');
        // 3. Idempotency Check
        const existingEvent = await AdminValidationEvent_1.AdminValidationEventModel.findOne({ idempotencyKey }).exec();
        if (existingEvent) {
            if (existingEvent.payloadHash === payloadHash) {
                return existingEvent;
            }
            const err = new Error(`IDEMPOTENCY_CONFLICT: An event with idempotencyKey '${idempotencyKey}' already exists with a different payload.`);
            err.status = 409;
            throw err;
        }
        // 4. Retry Loop for Transient WriteConflicts & Concurrent Idempotency
        let attempts = 0;
        while (attempts < 3) {
            attempts++;
            try {
                return await this.executeFeedbackTransaction(params, payloadHash, mlFeedbackRole);
            }
            catch (txErr) {
                // Check if concurrent request already succeeded
                const existingCheck = await AdminValidationEvent_1.AdminValidationEventModel.findOne({ idempotencyKey }).exec();
                if (existingCheck) {
                    if (existingCheck.payloadHash === payloadHash) {
                        return existingCheck;
                    }
                    const err = new Error(`IDEMPOTENCY_CONFLICT: An event with idempotencyKey '${idempotencyKey}' already exists with a different payload.`);
                    err.status = 409;
                    throw err;
                }
                const isTransient = txErr && (txErr.code === 112 ||
                    (txErr.errorLabels && typeof txErr.errorLabels.includes === 'function' && txErr.errorLabels.includes('TransientTransactionError')) ||
                    (txErr.message && (txErr.message.includes('WriteConflict') || txErr.message.includes('catalog changes'))));
                if (isTransient && attempts < 3) {
                    await new Promise(res => setTimeout(res, 100 * attempts));
                    continue;
                }
                throw txErr;
            }
        }
        throw new Error('FEEDBACK_TRANSACTION_FAILED: Maximum transaction retry attempts exceeded.');
    }
    async executeFeedbackTransaction(params, payloadHash, mlFeedbackRole) {
        const { reportId, snapshotId, previousValidationStatus, validationStatus, invalidReason, correctionPayload, validatedByUserId, idempotencyKey } = params;
        if (params.failTransactionSupport) {
            const err = new Error('TRANSACTION_SUPPORT_REQUIRED: MongoDB session transactions are required for transactional feedback processing.');
            err.status = 500;
            throw err;
        }
        const { ContinualLearningOutboxModel } = require('../../../database/models/ContinualLearningOutbox');
        const { AiDatasetCandidateModel } = require('../../../database/models/AiDatasetCandidate');
        const eventId = `val-event-${reportId}-${Date.now()}-${crypto_1.default.randomBytes(3).toString('hex')}`;
        let session = null;
        try {
            if (typeof mongoose_1.default.connection.startSession === 'function') {
                session = await mongoose_1.default.startSession();
                session.startTransaction();
            }
        }
        catch (sErr) {
            const err = new Error('TRANSACTION_SUPPORT_REQUIRED: Failed to initiate MongoDB session transaction.');
            err.status = 500;
            throw err;
        }
        try {
            // a. Create Immutable Validation Event
            const eventDocs = await AdminValidationEvent_1.AdminValidationEventModel.create([{
                    eventId,
                    reportId,
                    snapshotId: snapshotId ? new mongoose_1.default.Types.ObjectId(snapshotId) : null,
                    previousValidationStatus,
                    validationStatus,
                    invalidReason: invalidReason || null,
                    correctionPayload: correctionPayload || null,
                    validatedByUserId: new mongoose_1.default.Types.ObjectId(validatedByUserId),
                    idempotencyKey,
                    payloadHash,
                    mlFeedbackRole,
                    validatedAt: new Date()
                }], session ? { session } : {});
            const event = eventDocs[0];
            // b. Candidate Revision Routing
            if (snapshotId) {
                let updateData = {};
                if (validationStatus === 'VALID') {
                    updateData = { approvalStatus: 'APPROVED', datasetUsageRole: 'TRAINING_POSITIVE' };
                }
                else if (validationStatus === 'INVALID') {
                    if (invalidReason === 'FALSE_POSITIVE') {
                        updateData = { approvalStatus: 'APPROVED', datasetUsageRole: 'TRAINING_NEGATIVE' };
                    }
                    else if (invalidReason === 'WRONG_OBJECT') {
                        updateData = { approvalStatus: 'APPROVED', datasetUsageRole: 'CORRECTION' };
                    }
                    else if (invalidReason === 'INSUFFICIENT_EVIDENCE') {
                        updateData = { approvalStatus: 'REJECTED', datasetUsageRole: 'EXCLUDED' };
                    }
                    else {
                        updateData = { approvalStatus: 'REJECTED', datasetUsageRole: 'HUMAN_REVIEW' };
                    }
                }
                await AiDatasetCandidateModel.updateOne({ snapshotId }, {
                    $set: { ...updateData, lastValidationEventId: event._id },
                    $inc: { feedbackRevision: 1 }
                }, session ? { session } : {}).exec();
            }
            // c. Continual Learning Outbox Event Creation
            if (params.failOutboxWrite) {
                throw new Error('SIMULATED_OUTBOX_WRITE_FAILURE: Test failpoint triggered for outbox write failure.');
            }
            await ContinualLearningOutboxModel.create([{
                    eventId: `outbox-${eventId}`,
                    sourceEventId: eventId,
                    eventType: 'AI_FEEDBACK_RECORDED',
                    validationLogId: event._id,
                    snapshotId: snapshotId ? new mongoose_1.default.Types.ObjectId(snapshotId) : new mongoose_1.default.Types.ObjectId(),
                    reportId,
                    status: 'PENDING'
                }], session ? { session } : {});
            if (session) {
                await session.commitTransaction();
                session.endSession();
            }
            console.log(`[ADMIN_VALIDATION] Recorded ${validationStatus} feedback for Report #${reportId} (Role: ${mlFeedbackRole}, Reason: ${invalidReason || 'NONE'})`);
            return event;
        }
        catch (txErr) {
            if (session && typeof session.inTransaction === 'function' && session.inTransaction()) {
                await session.abortTransaction();
            }
            if (session) {
                session.endSession();
            }
            throw txErr;
        }
    }
    async migrateLegacyValidationStatuses(legacyRecords) {
        let totalLegacyRecords = legacyRecords.length;
        let migratedRecordCount = 0;
        let skippedRecordCount = 0;
        let failedRecordCount = 0;
        const previousStatusBreakdown = {};
        const migrationPayloads = [];
        for (const rec of legacyRecords) {
            const prev = String(rec.previousStatus || '').toUpperCase();
            previousStatusBreakdown[prev] = (previousStatusBreakdown[prev] || 0) + 1;
            if (['ABAIKAN', 'DIABAIKAN', 'IGNORED', 'DISMISSED'].includes(prev)) {
                migratedRecordCount++;
                migrationPayloads.push({ id: rec.id, from: prev, to: 'INVALID' });
            }
            else if (['VALID', 'INVALID', 'PENDING', 'MENUNGGU'].includes(prev)) {
                skippedRecordCount++;
            }
            else {
                failedRecordCount++;
            }
        }
        const migrationHash = crypto_1.default.createHash('sha256').update(JSON.stringify({ totalLegacyRecords, migratedRecordCount, skippedRecordCount, migrationPayloads })).digest('hex');
        const result = {
            totalLegacyRecords,
            migratedRecordCount,
            skippedRecordCount,
            failedRecordCount,
            previousStatusBreakdown,
            migrationHash,
            migratedAt: new Date()
        };
        console.log(`[LEGACY_MIGRATION] Migrated ${migratedRecordCount}/${totalLegacyRecords} legacy records (Skipped: ${skippedRecordCount}, Failed: ${failedRecordCount}, Hash: ${migrationHash.slice(0, 8)})`);
        return result;
    }
}
exports.AdminValidationFeedbackService = AdminValidationFeedbackService;
exports.adminValidationFeedbackService = new AdminValidationFeedbackService();
