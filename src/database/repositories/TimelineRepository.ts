import { TimelineEventModel, ITimelineEvent } from '../models/TimelineEvent';
import mongoose from 'mongoose';

export class TimelineRepository {
  public static async create(
    eventData: Partial<ITimelineEvent>[], 
    session?: mongoose.mongo.ClientSession
  ): Promise<ITimelineEvent[]> {
    const options = session ? { session } : {};
    const events = await TimelineEventModel.insertMany(eventData, options);
    // Convert Mongoose Documents to DTOs (plain objects)
    return events.map(e => e.toObject() as ITimelineEvent);
  }

  public static async findByReportId(reportId: mongoose.Types.ObjectId | string): Promise<ITimelineEvent[]> {
    const events = await TimelineEventModel.find({ reportId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return events as ITimelineEvent[];
  }
}
