import { INotificationChannel } from './NotificationChannel';
import { IReport } from '../database/models/Report';
import { NotificationModel } from '../database/models/Notification';
import { UserModel } from '../database/models/User';

export class WebNotificationChannel implements INotificationChannel {
  public name = 'WebNotification';

  public async send(report: IReport): Promise<boolean> {
    try {
      // 1. Dapatkan daftar seluruh user penerima notifikasi (admin, operator, supervisor)
      const recipients = await UserModel.find({
        role: { $in: ['admin', 'operator', 'supervisor'] }
      });

      if (recipients.length === 0) return false;

      const priority = report.aiStatus === 'TINGGI' ? 'HIGH' : (report.aiStatus === 'SEDANG' ? 'MEDIUM' : 'LOW');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // Kedaluwarsa 90 hari (TTL)

      // 2. Buat notifikasi di database untuk setiap user penerima
      const notifications = recipients.map(user => ({
        recipientId: user._id,
        reportId: report._id,
        type: 'AI_DETECTION',
        title: `Tanggapan AI Baru: Laporan #${report.id}`,
        message: `Anomali '${report.aiStatus}' terdeteksi di lokasi ${report.location}.`,
        actionUrl: `/dashboard/detections/${report.id}`,
        icon: 'alert-triangle',
        priority,
        read: false,
        readAt: null,
        expiresAt,
        deletedAt: null
      }));

      await NotificationModel.insertMany(notifications);
      console.log(`[WebNotificationChannel] Web notifications generated for ${recipients.length} recipients for Report #${report.id}`);
      return true;

    } catch (err) {
      console.error(`[WebNotificationChannel] Failed to create web notifications for Report #${report.id}:`, err);
      return false;
    }
  }
}
