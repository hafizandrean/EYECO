import { ReportModel, IReport, IBoundingBox, IComment } from '../models/Report';
import { UserModel } from '../models/User';
import mongoose from 'mongoose';
import { WorkspaceModel } from '../models/Workspace';

export class ReportRepository {
  public static async findById(id: mongoose.Types.ObjectId | string): Promise<IReport | null> {
    const report = await ReportModel.findOne({ _id: id, deletedAt: null }).exec();
    return report;
  }

  public static async findByLegacyId(id: number): Promise<IReport | null> {
    const report = await ReportModel.findOne({ id, deletedAt: null }).exec();
    return report;
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
    ).exec();
    return report;
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
    ).exec();
    return report;
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
    ).exec();
    return report;
  }

  // --- CRUD/CRUD-Like Methods originally in DatabaseManager ---

  public static async create(
    report: {
      location: string;
      aiStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
      aiConfidence: number | null;
      image: string;
      identity?: string;
      sourceType: string;
      additionalNotes?: string;
      boundingBoxes?: IBoundingBox[];
    }, 
    creatorId: number
  ): Promise<IReport> {
    try {
      const lastReport = await ReportModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastReport ? lastReport.id + 1 : 1;

      // Find user _id for the ref based on legacy creatorId
      const user = await UserModel.findOne({ id: creatorId }).lean().exec();
      const userObjectId = user ? (user._id as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId();

      const workspaces = await WorkspaceModel.find({}).lean().exec();
      let matchedWorkspaceId: number | undefined;
      const reportLocationLower = report.location.toLowerCase();
      for (const w of workspaces) {
        if (reportLocationLower.includes(w.name.toLowerCase()) || reportLocationLower.includes(w.location.toLowerCase())) {
          matchedWorkspaceId = w.id;
          break;
        }
      }

      const newReport = await ReportModel.create({
        ...report,
        id: nextId,
        userId: userObjectId,
        timestamp: new Date(),
        adminStatus: 'MENUNGGU',
        adminNotes: '',
        workspaceId: matchedWorkspaceId,
        sla: {
          detectedAt: new Date(),
          validatedAt: null,
          assignedAt: null,
          arrivedAt: null,
          resolvedAt: null,
          closedAt: null,
          validationDurationMs: null,
          assignmentDurationMs: null,
          cleanupDurationMs: null,
          resolutionDurationMs: null,
          totalDurationMs: null
        }
      });

      return newReport;
    } catch (err) {
      console.error('[DATABASE ERROR] create report failed:', err);
      throw err;
    }
  }

  public static async updateVerification(
    id: number, 
    status: 'VALID' | 'DIABAIKAN' | 'MENUNGGU', 
    notes: string,
    assignedOfficer?: string,
    progressStatus?: 'NEW' | 'UNDER_REVIEW' | 'VALIDATED' | 'ASSIGNED' | 'ON_SITE' | 'IN_PROGRESS' | 'RESOLVED' | 'WAITING_APPROVAL' | 'CLOSED' | 'REJECTED'
  ): Promise<IReport | null> {
    try {
      const updateFields: any = { adminStatus: status, adminNotes: notes };
      if (assignedOfficer !== undefined) {
        updateFields.assignedOfficer = assignedOfficer;
      }
      if (progressStatus !== undefined) {
        updateFields.status = progressStatus;
      } else {
        if (status === 'VALID') {
          updateFields.status = 'VALIDATED';
        } else if (status === 'DIABAIKAN') {
          updateFields.status = 'REJECTED';
        }
      }

      const updated = await ReportModel.findOneAndUpdate(
        { id }, 
        updateFields, 
        { new: true }
      ).exec();
      return updated;
    } catch (err) {
      console.error('[DATABASE ERROR] updateVerification failed:', err);
      throw err;
    }
  }

  public static async getFiltered(
    filters: {
      timeRange?: string;
      date?: string;
      aiStatus?: string;
      adminStatus?: string;
      location?: string;
    },
    userContext: { id: number; role: string },
    page?: number,
    limit?: number
  ): Promise<{ reports: IReport[]; total: number } | IReport[]> {
    try {
      const query: any = { deletedAt: null };

      if (userContext.role === 'admin') {
        const adminUser = await UserModel.findOne({ id: userContext.id }).lean().exec();
        if (adminUser && adminUser.workspaceId) {
          const ws = await WorkspaceModel.findOne({ id: adminUser.workspaceId }).lean().exec();
          if (ws) {
            query.$or = [
              { workspaceId: adminUser.workspaceId },
              { location: new RegExp(ws.name, 'i') },
              { location: new RegExp(ws.location, 'i') }
            ];
          } else {
            query.workspaceId = adminUser.workspaceId;
          }
        } else {
          query.workspaceId = -1;
        }
      }

      if (filters.date) {
        const start = new Date(filters.date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(filters.date);
        end.setHours(23, 59, 59, 999);
        query.timestamp = { $gte: start, $lte: end };
      } else if (filters.timeRange && filters.timeRange !== 'semua') {
        const now = new Date();
        if (filters.timeRange === 'hari_ini') {
          const start = new Date(now);
          start.setHours(0, 0, 0, 0);
          query.timestamp = { $gte: start };
        } else if (filters.timeRange === 'minggu_ini') {
          const oneWeekAgo = new Date();
          oneWeekAgo.setDate(now.getDate() - 7);
          query.timestamp = { $gte: oneWeekAgo };
        }
      }

      if (filters.aiStatus && filters.aiStatus !== 'semua') {
        query.aiStatus = filters.aiStatus;
      }

      if (filters.adminStatus && filters.adminStatus !== 'semua') {
        query.adminStatus = filters.adminStatus;
      }

      if (filters.location && filters.location.trim() !== '') {
        const regex = new RegExp(filters.location, 'i');
        query.$or = [
          { location: regex },
          { identity: regex }
        ];
      }

      const q = ReportModel.find(query).sort({ timestamp: -1 });

      if (page !== undefined && limit !== undefined) {
        const skip = (page - 1) * limit;
        const [reports, total] = await Promise.all([
          q.skip(skip).limit(limit).exec(),
          ReportModel.countDocuments(query).exec()
        ]);
        return { reports, total };
      } else {
        return await q.exec();
      }
    } catch (err) {
      console.error('[DATABASE ERROR] getFiltered failed:', err);
      throw err;
    }
  }

  public static async getStats(userContext?: { id: number; role: string }) {
    try {
      const matchQuery: any = { deletedAt: null };

      const [total, valid, cancelled, pending] = await Promise.all([
        ReportModel.countDocuments(matchQuery),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
        ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' })
      ]);

      const vulnGroup = await ReportModel.aggregate([
        { $match: { ...matchQuery, aiStatus: { $in: ['TINGGI', 'SEDANG'] } } },
        { $group: { _id: '$location', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 1 }
      ]);

      let mostVulnerable = vulnGroup.length > 0 ? vulnGroup[0]._id : '-';

      if (total > 0 && mostVulnerable === '-') {
        const overallGroup = await ReportModel.aggregate([
          { $match: matchQuery },
          { $group: { _id: '$location', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 }
        ]);
        if (overallGroup.length > 0) {
          mostVulnerable = overallGroup[0]._id;
        }
      }

      return {
        total,
        mostVulnerable,
        valid,
        cancelled,
        pending
      };
    } catch (err) {
      console.error('[DATABASE ERROR] getStats failed:', err);
      throw err;
    }
  }

  // --- COMMENT METHODS ---

  public static async addComment(
    reportId: number,
    userId: number,
    text: string
  ): Promise<IComment> {
    try {
      const sanitized = text.replace(/<[^>]*>/g, '').trim();

      if (sanitized.length < 2 || sanitized.length > 500) {
        throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
      }

      const report = await ReportModel.findOne({ id: reportId, deletedAt: null });
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const commentData = {
        userId,
        text: sanitized,
        likedBy: [],
        isDeleted: false,
        parentCommentId: null
      };

      report.comments.push(commentData as any);
      await report.save();

      return report.comments[report.comments.length - 1];
    } catch (err) {
      console.error('[DATABASE ERROR] addComment failed:', err);
      throw err;
    }
  }

  public static async deleteComment(
    reportId: number,
    commentId: string,
    userId: number,
    isAdmin: boolean
  ): Promise<IComment> {
    try {
      const report = await ReportModel.findOne({ id: reportId, deletedAt: null });
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const comment = report.comments.id(commentId);
      if (!comment) {
        throw new Error('Komentar tidak ditemukan.');
      }

      if (comment.userId !== userId && !isAdmin) {
        throw new Error('Anda tidak memiliki akses untuk menghapus komentar ini.');
      }

      comment.isDeleted = true;
      await report.save();

      return comment;
    } catch (err) {
      console.error('[DATABASE ERROR] deleteComment failed:', err);
      throw err;
    }
  }

  public static async toggleLikeComment(
    reportId: number,
    commentId: string,
    userId: number
  ): Promise<IComment> {
    try {
      const report = await ReportModel.findOne({ id: reportId, deletedAt: null });
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const comment = report.comments.id(commentId);
      if (!comment) {
        throw new Error('Komentar tidak ditemukan.');
      }

      if (comment.isDeleted) {
        throw new Error('Komentar telah dihapus.');
      }

      const index = comment.likedBy.indexOf(userId);
      if (index > -1) {
        comment.likedBy.splice(index, 1);
      } else {
        comment.likedBy.push(userId);
      }

      await report.save();
      return comment;
    } catch (err) {
      console.error('[DATABASE ERROR] toggleLikeComment failed:', err);
      throw err;
    }
  }
}
