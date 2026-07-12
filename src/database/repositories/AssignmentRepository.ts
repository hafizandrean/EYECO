import { AssignmentModel, IAssignment } from '../models/Assignment';
import mongoose from 'mongoose';

export class AssignmentRepository {
  public static async findById(id: mongoose.Types.ObjectId | string, workspaceId?: number): Promise<IAssignment | null> {
    const query: Record<string, unknown> = { _id: id };
    if (workspaceId !== undefined) query.workspaceId = workspaceId;
    const assignment = await AssignmentModel.findOne(query).lean().exec();
    return assignment as IAssignment | null;
  }

  public static async create(
    assignmentData: Partial<IAssignment>[], 
    session?: mongoose.mongo.ClientSession
  ): Promise<IAssignment[]> {
    const options = session ? { session } : {};
    const assignments = await AssignmentModel.insertMany(assignmentData, options);
    return assignments.map(a => a.toObject() as IAssignment);
  }

  public static async deactivateActive(
    reportId: mongoose.Types.ObjectId | string,
    status: 'CANCELLED' | 'REASSIGNED' | 'COMPLETED',
    workspaceId?: number,
    session?: mongoose.mongo.ClientSession
  ): Promise<void> {
    const options = {};
    if (session) {
      Object.assign(options, { session });
    }
    const query: Record<string, unknown> = { reportId, endedAt: null };
    if (workspaceId !== undefined) query.workspaceId = workspaceId;
    await AssignmentModel.updateMany(
      query,
      { $set: { endedAt: new Date(), status } },
      options
    ).exec();
  }

  public static async findActiveByReportId(reportId: mongoose.Types.ObjectId | string, workspaceId?: number): Promise<IAssignment | null> {
    const query: Record<string, unknown> = { reportId, endedAt: null };
    if (workspaceId !== undefined) query.workspaceId = workspaceId;
    const assignment = await AssignmentModel.findOne(query).lean().exec();
    return assignment as IAssignment | null;
  }

  public static async findByReportId(reportId: mongoose.Types.ObjectId | string, workspaceId?: number): Promise<IAssignment[]> {
    const query: Record<string, unknown> = { reportId };
    if (workspaceId !== undefined) query.workspaceId = workspaceId;
    const assignments = await AssignmentModel.find(query).sort({ assignedAt: -1 }).lean().exec();
    return assignments as IAssignment[];
  }
}
