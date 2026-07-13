import { ReportModel, IReport, IBoundingBox, IComment } from '../models/Report';
import { UserModel } from '../models/User';
import mongoose from 'mongoose';
import { WorkspaceModel } from '../models/Workspace';

export class ReportRepository {
  public static async findById(id: mongoose.Types.ObjectId | string, workspaceId?: number): Promise<IReport | null> {
    const query: Record<string, unknown> = { _id: id, deletedAt: null };
    if (workspaceId !== undefined) query.workspaceId = workspaceId;
    const report = await ReportModel.findOne(query).exec();
    return report;
  }

  public static async findByLegacyId(id: number, workspaceId?: number): Promise<IReport | null> {
    const query: Record<string, unknown> = { id, deletedAt: null };
    if (workspaceId !== undefined) query.workspaceId = workspaceId;
    const report = await ReportModel.findOne(query).exec();
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

      // Use the workspaceId from the user's active session
      const user = await UserModel.findOne({ id: creatorId }).lean().exec();
      const userObjectId = user ? (user._id as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId();
      const workspaceId = (user as any)?.workspaceId;

      if (!workspaceId) {
        throw new Error('User has no active workspace selected');
      }

      const newReport = await ReportModel.create({
        ...report,
        id: nextId,
        userId: userObjectId,
        timestamp: new Date(),
        adminStatus: 'MENUNGGU',
        adminNotes: '',
        workspaceId: workspaceId,
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
    progressStatus?: 'NEW' | 'UNDER_REVIEW' | 'VALIDATED' | 'ASSIGNED' | 'ON_SITE' | 'IN_PROGRESS' | 'RESOLVED' | 'WAITING_APPROVAL' | 'CLOSED' | 'REJECTED',
    workspaceId?: number
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

      const query: Record<string, unknown> = { id };
      if (workspaceId !== undefined) query.workspaceId = workspaceId;

      const updated = await ReportModel.findOneAndUpdate(
        query, 
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

      if (userContext.role === 'admin' || userContext.role === 'user') {
        const user = await UserModel.findOne({ id: userContext.id }).lean().exec();
        if (user && (user as any).workspaceId) {
          query.workspaceId = (user as any).workspaceId;
          if (userContext.role === 'user') {
            query.userId = user._id;
          }
        } else {
          // If no workspace is selected or found, return empty results
          query.workspaceId = -1;
        }
      } else if (userContext.role === 'superadmin') {
        // Superadmin only sees reports from workspaces they own
        const ownedWorkspaces = await WorkspaceModel.find({ superadminId: userContext.id }).lean().exec();
        const wsIds = ownedWorkspaces.map(w => w.id);
        query.workspaceId = { $in: wsIds };
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

  private static async buildWorkspaceScope(userContext?: { id: number; role: string }): Promise<Record<string, unknown>> {
    if (!userContext) return { workspaceId: -1 };

    if (userContext.role === 'admin' || userContext.role === 'user') {
      const user = await UserModel.findOne({ id: userContext.id }).lean().exec();
      if (!user?.workspaceId) return { workspaceId: -1 };
      return userContext.role === 'user'
        ? { workspaceId: user.workspaceId, userId: user._id }
        : { workspaceId: user.workspaceId };
    }

    if (userContext.role === 'superadmin') {
      const ownedWorkspaces = await WorkspaceModel.find({ superadminId: userContext.id }).lean().exec();
      return { workspaceId: { $in: ownedWorkspaces.map((workspace) => workspace.id) } };
    }

    return { workspaceId: -1 };
  }

  public static async getStats(userContext?: { id: number; role: string }) {
    try {
      const matchQuery: any = { deletedAt: null, ...(await this.buildWorkspaceScope(userContext)) };

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
    text: string,
    workspaceId?: number
  ): Promise<IComment> {
    try {
      const sanitized = text.replace(/<[^>]*>/g, '').trim();

      if (sanitized.length < 2 || sanitized.length > 500) {
        throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
      }

      const query: Record<string, unknown> = { id: reportId, deletedAt: null };
      if (workspaceId !== undefined) query.workspaceId = workspaceId;
      const report = await ReportModel.findOne(query);
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
    isAdmin: boolean,
    workspaceId?: number
  ): Promise<IComment> {
    try {
      const query: Record<string, unknown> = { id: reportId, deletedAt: null };
      if (workspaceId !== undefined) query.workspaceId = workspaceId;
      const report = await ReportModel.findOne(query);
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
    userId: number,
    workspaceId?: number
  ): Promise<IComment> {
    try {
      const query: Record<string, unknown> = { id: reportId, deletedAt: null };
      if (workspaceId !== undefined) query.workspaceId = workspaceId;
      const report = await ReportModel.findOne(query);
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
