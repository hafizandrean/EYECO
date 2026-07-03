"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignmentRepository = void 0;
const Assignment_1 = require("../models/Assignment");
class AssignmentRepository {
    static async findById(id) {
        const assignment = await Assignment_1.AssignmentModel.findById(id).lean().exec();
        return assignment;
    }
    static async create(assignmentData, session) {
        const options = session ? { session } : {};
        const assignments = await Assignment_1.AssignmentModel.insertMany(assignmentData, options);
        return assignments.map(a => a.toObject());
    }
    static async deactivateActive(reportId, status, session) {
        const options = {};
        if (session) {
            Object.assign(options, { session });
        }
        await Assignment_1.AssignmentModel.updateMany({ reportId, endedAt: null }, { $set: { endedAt: new Date(), status } }, options).exec();
    }
    static async findActiveByReportId(reportId) {
        const assignment = await Assignment_1.AssignmentModel.findOne({ reportId, endedAt: null }).lean().exec();
        return assignment;
    }
    static async findByReportId(reportId) {
        const assignments = await Assignment_1.AssignmentModel.find({ reportId }).sort({ assignedAt: -1 }).lean().exec();
        return assignments;
    }
}
exports.AssignmentRepository = AssignmentRepository;
