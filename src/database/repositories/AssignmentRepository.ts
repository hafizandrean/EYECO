import { AssignmentModel, IAssignment } from '../models/Assignment';
import mongoose from 'mongoose';

export class AssignmentRepository {
  public static async findById(id: mongoose.Types.ObjectId | string): Promise<IAssignment | null> {
    const assignment = await AssignmentModel.findById(id).lean().exec();
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
    session?: mongoose.mongo.ClientSession
  ): Promise<void> {
    const options = {};
    if (session) {
      Object.assign(options, { session });
    }
    await AssignmentModel.updateMany(
      { reportId, endedAt: null },
      { $set: { endedAt: new Date(), status } },
      options
    ).exec();
  }

  public static async findActiveByReportId(reportId: mongoose.Types.ObjectId | string): Promise<IAssignment | null> {
    const assignment = await AssignmentModel.findOne({ reportId, endedAt: null }).lean().exec();
    return assignment as IAssignment | null;
  }

  public static async findByReportId(reportId: mongoose.Types.ObjectId | string): Promise<IAssignment[]> {
    const assignments = await AssignmentModel.find({ reportId }).sort({ assignedAt: -1 }).lean().exec();
    return assignments as IAssignment[];
  }
}
