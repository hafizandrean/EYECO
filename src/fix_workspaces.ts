import { connectDB } from './database/db';
import { ReportModel } from './database/models/Report';
import { UserModel } from './database/models/User';
import { CctvModel } from './database/models/Cctv';

async function fixWorkspaces() {
  try {
    await connectDB();

    console.log('Unifying workspaceId to 1 for all users, reports, and CCTVs...');

    // Set workspaceId: 1 for ALL users
    await UserModel.updateMany({}, { $set: { workspaceId: 1 } });

    // Set workspaceId: 1 for ALL reports
    await ReportModel.updateMany({}, { $set: { workspaceId: 1 } });

    // Set workspaceId: 1 for ALL CCTVs
    await CctvModel.updateMany({}, { $set: { workspaceId: 1 } });

    console.log('✅ ALL users, reports, and CCTVs unified to workspaceId: 1!');

    const reportsCount = await ReportModel.countDocuments({ workspaceId: 1, deletedAt: null });
    console.log(`Verified ${reportsCount} active reports in workspaceId 1`);

    process.exit(0);
  } catch (err) {
    console.error('Error in fixWorkspaces:', err);
    process.exit(1);
  }
}

fixWorkspaces();
