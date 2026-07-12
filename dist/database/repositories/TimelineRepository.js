"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelineRepository = void 0;
const TimelineEvent_1 = require("../models/TimelineEvent");
class TimelineRepository {
    static async create(eventData, session) {
        const options = session ? { session } : {};
        const events = await TimelineEvent_1.TimelineEventModel.insertMany(eventData, options);
        // Convert Mongoose Documents to DTOs (plain objects)
        return events.map(e => e.toObject());
    }
    static async findByReportId(reportId, workspaceId) {
        const query = { reportId };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        const events = await TimelineEvent_1.TimelineEventModel.find(query)
            .sort({ createdAt: -1 })
            .lean()
            .exec();
        return events;
    }
}
exports.TimelineRepository = TimelineRepository;
