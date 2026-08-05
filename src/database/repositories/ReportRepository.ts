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
    const options: any = { new: true, returnDocument: 'after', runValidators: true };
    if (session) {
      Object.assign(options, { session });
    }
    const report = (await ReportModel.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: updateData },
      options
    ).exec() as unknown) as IReport | null;
    return report;
  }

  public static async softDelete(
    id: mongoose.Types.ObjectId | string,
    actorId: mongoose.Types.ObjectId,
    actorName: string,
    reason: string,
    session?: mongoose.mongo.ClientSession
  ): Promise<IReport | null> {
    const options: any = { new: true, returnDocument: 'after' };
    if (session) {
      Object.assign(options, { session });
    }
    const report = (await ReportModel.findOneAndUpdate(
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
    ).exec() as unknown) as IReport | null;
    return report;
  }

  public static async restore(
    id: mongoose.Types.ObjectId | string,
    reason: string,
    session?: mongoose.mongo.ClientSession
  ): Promise<IReport | null> {
    const options: any = { new: true, returnDocument: 'after' };
    if (session) {
      Object.assign(options, { session });
    }
    const report = (await ReportModel.findOneAndUpdate(
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
    ).exec() as unknown) as IReport | null;
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

      // Auto-delete 40 days after validation: set scheduledDeletionAt when VALID or DIABAIKAN
      if (status === 'VALID' || status === 'DIABAIKAN') {
        updateFields.scheduledDeletionAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
        // Catat waktu verifikasi (untuk review duration)
        updateFields.verifiedAt = new Date();
      } else {
        updateFields.scheduledDeletionAt = null;
        updateFields.verifiedAt = null;
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
      myReports?: boolean;
    },
    userContext: { id: number; role: string },
    page?: number,
    limit?: number
  ): Promise<{ reports: IReport[]; total: number } | IReport[]> {
    try {
      const query: any = { deletedAt: null };

      if (userContext.role === 'admin') {
        const user = await UserModel.findOne({ id: userContext.id }).lean().exec();
        const wsId = (user as any)?.workspaceId;
        if (wsId) {
          query.workspaceId = wsId;
        } else {
          query.workspaceId = -1; // No workspace assigned = no results
        }
      } else if (userContext.role === 'user' || userContext.role === 'operator') {
        // User/Operator sees all non-deleted reports in their workspace
        const user = await UserModel.findOne({ id: userContext.id }).lean().exec();
        if (user && (user as any).workspaceId) {
          query.workspaceId = (user as any).workspaceId;
        } else {
          query.workspaceId = -1;
        }
        query.sourceType = { $ne: 'AI_CCTV' };
      } else if (userContext.role === 'superadmin') {
        const ownedWorkspaces = await WorkspaceModel.find({ superadminId: userContext.id }).lean().exec();
        const wsIds = ownedWorkspaces.map(w => w.id);
        if (wsIds.length > 0) {
          query.workspaceId = { $in: wsIds };
        } else {
          query.workspaceId = -1; // No owned workspaces = no results
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

      // ── Filter: Laporan Saya ──
      if (filters.myReports) {
        const currentUser = await UserModel.findOne({ id: userContext.id }).lean().exec();
        if (currentUser) {
          query.userId = currentUser._id;
        }
      }

      const q = ReportModel.find(query).sort({ timestamp: -1 });

      if (page !== undefined && limit !== undefined) {
        const skip = (page - 1) * limit;
        let [reports, total] = await Promise.all([
          q.skip(skip).limit(limit).exec(),
          ReportModel.countDocuments(query).exec()
        ]);

        // Fallback untuk superadmin: jika tidak ada hasil dari workspace sendiri,
        // cari semua report (tanpa filter workspaceId)
        if (reports.length === 0 && total === 0 && userContext.role === 'superadmin') {
          const fallbackQuery = { ...query };
          delete fallbackQuery.workspaceId;
          [reports, total] = await Promise.all([
            ReportModel.find(fallbackQuery).sort({ timestamp: -1 }).skip(skip).limit(limit).exec(),
            ReportModel.countDocuments(fallbackQuery).exec()
          ]);
        }

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
      return { workspaceId: user.workspaceId };
    }

    if (userContext.role === 'superadmin') {
      const ownedWorkspaces = await WorkspaceModel.find({ superadminId: userContext.id }).lean().exec();
      const wsIds = ownedWorkspaces.map(w => w.id);
      if (wsIds.length > 0) {
        return { workspaceId: { $in: wsIds } };
      }
      return { workspaceId: -1 };
    }

    return { workspaceId: -1 };
  }

  public static async getGlobalStats() {
    const matchQuery: any = { deletedAt: null };
    const [total, valid, cancelled, pending, tinggi, sedang, rendah, tidakTerindikasi] = await Promise.all([
      ReportModel.countDocuments(matchQuery),
      ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
      ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
      ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' }),
      ReportModel.countDocuments({ ...matchQuery, aiStatus: 'TINGGI' }),
      ReportModel.countDocuments({ ...matchQuery, aiStatus: 'SEDANG' }),
      ReportModel.countDocuments({ ...matchQuery, aiStatus: 'RENDAH' }),
      ReportModel.countDocuments({ ...matchQuery, aiStatus: 'Tidak Terindikasi' })
    ]);
    return { total, valid, cancelled, pending, tinggi, sedang, rendah, tidakTerindikasi };
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

      // Fallback: jika superadmin hasil 0, coba tanpa filter workspace
      if (total === 0 && userContext?.role === 'superadmin') {
        const fallbackQuery: any = { deletedAt: null };
        const [total2, valid2, cancelled2, pending2] = await Promise.all([
          ReportModel.countDocuments(fallbackQuery),
          ReportModel.countDocuments({ ...fallbackQuery, adminStatus: 'VALID' }),
          ReportModel.countDocuments({ ...fallbackQuery, adminStatus: 'DIABAIKAN' }),
          ReportModel.countDocuments({ ...fallbackQuery, adminStatus: 'MENUNGGU' })
        ]);
        if (total2 > 0) {
          // Hitung distribusi AI untuk fallback
          const [fbTinggi, fbSedang, fbRendah, fbTidak] = await Promise.all([
            ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'TINGGI' }),
            ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'SEDANG' }),
            ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'RENDAH' }),
            ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'Tidak Terindikasi' })
          ]);
          const fbSevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          const fbRecent = await ReportModel.countDocuments({
            ...fallbackQuery,
            $or: [
              { adminStatus: 'MENUNGGU' },
              { timestamp: { $gte: fbSevenDaysAgo } }
            ]
          });
          return { total: total2, mostVulnerable: '-', valid: valid2, cancelled: cancelled2, pending: pending2, tinggi: fbTinggi, sedang: fbSedang, rendah: fbRendah, tidakTerindikasi: fbTidak, recent: fbRecent, myReports: 0 };
        }
      }

      // Hitung distribusi AI status
      const [tinggi, sedang, rendah, tidakTerindikasi] = await Promise.all([
        ReportModel.countDocuments({ ...matchQuery, aiStatus: 'TINGGI' }),
        ReportModel.countDocuments({ ...matchQuery, aiStatus: 'SEDANG' }),
        ReportModel.countDocuments({ ...matchQuery, aiStatus: 'RENDAH' }),
        ReportModel.countDocuments({ ...matchQuery, aiStatus: 'Tidak Terindikasi' })
      ]);

      // "Laporan Terkini" = laporan MENUNGGU (any age) ATAU laporan dalam 7 hari terakhir
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recent = await ReportModel.countDocuments({
        ...matchQuery,
        $or: [
          { adminStatus: 'MENUNGGU' },
          { timestamp: { $gte: sevenDaysAgo } }
        ]
      });

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

      // Hitung jumlah laporan milik user yang sedang login
      let myReportsCount = 0;
      if (userContext?.id) {
        const currentUser = await UserModel.findOne({ id: userContext.id }).select('_id').lean().exec();
        if (currentUser) {
          myReportsCount = await ReportModel.countDocuments({ ...matchQuery, userId: currentUser._id }).exec();
        }
      }

      return {
        total,
        mostVulnerable,
        valid,
        cancelled,
        pending,
        tinggi,
        sedang,
        rendah,
        tidakTerindikasi,
        recent,
        myReports: myReportsCount
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
    workspaceId?: number,
    parentCommentId?: string | null
  ): Promise<IComment> {
    try {
      const sanitized = text.replace(/<[^>]*>/g, '').trim();

      if (sanitized.length < 2 || sanitized.length > 500) {
        throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
      }

      // If replying, validate parent comment exists first
      if (parentCommentId) {
        const parentReport = await ReportModel.findOne(
          { id: reportId, deletedAt: null, 'comments._id': parentCommentId },
          { 'comments.$': 1 }
        ).lean().exec();
        if (!parentReport || !parentReport.comments || parentReport.comments.length === 0) {
          throw new Error('Komentar induk tidak ditemukan.');
        }
      }

      // Query WITHOUT workspaceId — karena report LAMA tidak punya field workspaceId
      const query: Record<string, unknown> = { id: reportId, deletedAt: null };

      let report = await ReportModel.findOne(query).lean().exec();
      if (!report) {
        // Fallback: coba dengan workspaceId (untuk report BARU)
        if (workspaceId !== undefined) {
          const query2: Record<string, unknown> = { id: reportId, deletedAt: null, workspaceId };
          report = await ReportModel.findOne(query2).lean().exec();
        }

        if (!report) {
          throw new Error('Laporan tidak ditemukan.');
        }
      }

      const commentData = {
        userId,
        text: sanitized,
        likedBy: [],
        isDeleted: false,
        parentCommentId: parentCommentId || null
      } as any;

      // Gunakan findOneAndUpdate untuk atomic push (hindari masalah dengan timestamps)
      const updated = await ReportModel.findOneAndUpdate(
        { _id: report._id },
        { $push: { comments: commentData } },
        { new: true }
      ).exec();

      if (!updated) {
        throw new Error('Gagal menambahkan komentar.');
      }

      const newComment = updated.comments[updated.comments.length - 1];
      return newComment;
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
  ): Promise<void> {
    try {
      // Try without workspaceId first
      const query: Record<string, unknown> = { id: reportId, deletedAt: null };
      if (workspaceId !== undefined) {
        query.workspaceId = workspaceId;
      }

      const report = await ReportModel.findOne(query).exec();
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const comment = report.comments.id(commentId);
      if (!comment) {
        throw new Error('Komentar tidak ditemukan.');
      }

      // Only allow deletion if user owns comment or is admin
      if (!isAdmin && comment.userId !== userId) {
        throw new Error('Tidak diizinkan menghapus komentar orang lain.');
      }

      comment.isDeleted = true;
      await report.save();
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
      if (workspaceId !== undefined) {
        query.workspaceId = workspaceId;
      }

      const report = await ReportModel.findOne(query).exec();
      if (!report) {
        throw new Error('Laporan tidak ditemukan.');
      }

      const comment = report.comments.id(commentId);
      if (!comment) {
        throw new Error('Komentar tidak ditemukan.');
      }

      const likedIndex = comment.likedBy.indexOf(userId);
      if (likedIndex === -1) {
        comment.likedBy.push(userId);
      } else {
        comment.likedBy.splice(likedIndex, 1);
      }

      await report.save();
      return comment;
    } catch (err) {
      console.error('[DATABASE ERROR] toggleLikeComment failed:', err);
      throw err;
    }
  }
}