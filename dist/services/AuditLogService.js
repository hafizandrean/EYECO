"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogService = exports.AuditAction = void 0;
const db_1 = require("../database/db");
var AuditAction;
(function (AuditAction) {
    AuditAction["PROFILE_UPDATED"] = "PROFILE_UPDATED";
    AuditAction["PASSWORD_CHANGED"] = "PASSWORD_CHANGED";
    AuditAction["PREFERENCES_UPDATED"] = "PREFERENCES_UPDATED";
    AuditAction["ACCOUNT_CLOSED"] = "ACCOUNT_CLOSED";
    AuditAction["LOGOUT"] = "LOGOUT";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
class AuditLogService {
    static async log(data) {
        try {
            await db_1.SystemAuditLogModel.create({
                tenantId: data.tenantId || 'BBWS',
                actorId: data.actorId,
                actorName: data.actorName,
                action: data.action,
                ipAddress: data.ipAddress || '',
                userAgent: data.userAgent || '',
                details: {
                    ...data.details,
                    status: data.status,
                    requestId: data.requestId
                }
            });
        }
        catch (err) {
            console.error('[AUDIT LOG ERROR] Failed to write audit log:', err);
        }
    }
}
exports.AuditLogService = AuditLogService;
