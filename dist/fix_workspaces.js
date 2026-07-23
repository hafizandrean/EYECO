"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./database/db");
const Report_1 = require("./database/models/Report");
const User_1 = require("./database/models/User");
const Cctv_1 = require("./database/models/Cctv");
async function fixWorkspaces() {
    try {
        await (0, db_1.connectDB)();
        console.log('Unifying workspaceId to 1 for all users, reports, and CCTVs...');
        // Set workspaceId: 1 for ALL users
        await User_1.UserModel.updateMany({}, { $set: { workspaceId: 1 } });
        // Set workspaceId: 1 for ALL reports
        await Report_1.ReportModel.updateMany({}, { $set: { workspaceId: 1 } });
        // Set workspaceId: 1 for ALL CCTVs
        await Cctv_1.CctvModel.updateMany({}, { $set: { workspaceId: 1 } });
        console.log('✅ ALL users, reports, and CCTVs unified to workspaceId: 1!');
        const reportsCount = await Report_1.ReportModel.countDocuments({ workspaceId: 1, deletedAt: null });
        console.log(`Verified ${reportsCount} active reports in workspaceId 1`);
        process.exit(0);
    }
    catch (err) {
        console.error('Error in fixWorkspaces:', err);
        process.exit(1);
    }
}
fixWorkspaces();
