"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssignmentRepository = void 0;
const Assignment_1 = require("../models/Assignment");
class AssignmentRepository {
    static async findById(id, workspaceId) {
        const query = { _id: id };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        const assignment = await Assignment_1.AssignmentModel.findOne(query).lean().exec();
        return assignment;
    }
    static async create(assignmentData, session) {
        const options = session ? { session } : {};
        const assignments = await Assignment_1.AssignmentModel.insertMany(assignmentData, options);
        return assignments.map(a => a.toObject());
    }
    static async deactivateActive(reportId, status, workspaceId, session) {
        const options = {};
        if (session) {
            Object.assign(options, { session });
        }
        const query = { reportId, endedAt: null };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        await Assignment_1.AssignmentModel.updateMany(query, { $set: { endedAt: new Date(), status } }, options).exec();
    }
    static async findActiveByReportId(reportId, workspaceId) {
        const query = { reportId, endedAt: null };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        const assignment = await Assignment_1.AssignmentModel.findOne(query).lean().exec();
        return assignment;
    }
    static async findByReportId(reportId, workspaceId) {
        const query = { reportId };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        const assignments = await Assignment_1.AssignmentModel.find(query).sort({ assignedAt: -1 }).lean().exec();
        return assignments;
    }
}
exports.AssignmentRepository = AssignmentRepository;
