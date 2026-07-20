"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportRepository = void 0;
const Report_1 = require("../models/Report");
class ReportRepository {
    static async findById(id) {
        const report = await Report_1.ReportModel.findOne({ _id: id, deletedAt: null }).lean().exec();
        return report;
    }
    static async findByLegacyId(id) {
        const report = await Report_1.ReportModel.findOne({ id, deletedAt: null }).lean().exec();
        return report;
    }
    static async update(id, updateData, session) {
        const options = { returnDocument: 'after', runValidators: true };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: null }, { $set: updateData }, options).lean().exec();
        return report;
    }
    static async softDelete(id, actorId, actorName, reason, session) {
        const options = { returnDocument: 'after' };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: null }, {
            $set: {
                deletedAt: new Date(),
                deletedById: actorId,
                deletedByName: actorName,
                deleteReason: reason
            }
        }, options).lean().exec();
        return report;
    }
    static async restore(id, reason, session) {
        const options = { returnDocument: 'after' };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: { $ne: null } }, {
            $set: {
                deletedAt: null,
                deletedById: null,
                deletedByName: null,
                restoreReason: reason
            }
        }, options).lean().exec();
        return report;
    }
}
exports.ReportRepository = ReportRepository;
