import { ReportModel, IReport } from '../models/Report';
import mongoose from 'mongoose';

export class ReportRepository {
  public static async findById(id: mongoose.Types.ObjectId | string): Promise<IReport | null> {
    const report = await ReportModel.findOne({ _id: id, deletedAt: null }).lean().exec();
    return report as IReport | null;
  }

  public static async findByLegacyId(id: number): Promise<IReport | null> {
    const report = await ReportModel.findOne({ id, deletedAt: null }).lean().exec();
    return report as IReport | null;
  }

  public static async update(
    id: mongoose.Types.ObjectId | string, 
    updateData: Partial<IReport>, 
    session?: mongoose.mongo.ClientSession
  ): Promise<IReport | null> {
    const options = { new: true, runValidators: true };
    if (session) {
      Object.assign(options, { session });
    }
    const report = await ReportModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: updateData },
      options
    ).lean().exec();
    return report as IReport | null;
  }

  public static async softDelete(
    id: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId,
    actorName: string,
    reason: string,
    session?: mongoose.mongo.ClientSession
  ): Promise<IReport | null> {
    const options = { new: true };
    if (session) {
      Object.assign(options, { session });
    }
    const report = await ReportModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { 
        $set: { 
          deletedAt: new Date(), 
          deletedById: actorId, 
          deletedByName: actorName, 
          deleteReason: reason 
        } 
      },
      options
    ).lean().exec();
    return report as IReport | null;
  }

  public static async restore(
    id: mongoose.Types.ObjectId | string,
    reason: string,
    session?: mongoose.mongo.ClientSession
  ): Promise<IReport | null> {
    const options = { new: true };
    if (session) {
      Object.assign(options, { session });
    }
    const report = await ReportModel.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null } },
      { 
        $set: { 
          deletedAt: null, 
          deletedById: null, 
          deletedByName: null, 
          restoreReason: reason 
        } 
      },
      options
    ).lean().exec();
    return report as IReport | null;
  }
}
