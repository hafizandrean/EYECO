import { INotificationChannel } from './NotificationChannel';
import { IReport } from '../database/models/Report';
import { OutboxEventModel } from '../database/models/OutboxEvent';
import { SystemSettingsModel } from '../database/models/SystemSettings';
import fs from 'fs';
import path from 'path';

export class TelegramNotificationChannel implements INotificationChannel {
  public name = 'Telegram';

  public async send(report: IReport): Promise<boolean> {
    // 1. Simpan Outbox Event berstatus PENDING
    const outbox = await OutboxEventModel.create({
      aggregateType: 'Report',
      aggregateId: report._id.toString(),
      eventType: 'IncidentCreated',
      payload: report.toJSON(),
      status: 'PENDING'
    });

    try {
      // 2. Ambil token bot dan chat ID dari environment / database
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const isEnabledSetting = await SystemSettingsModel.findOne({ key: 'telegram.enabled' });
      const chatIdSetting = await SystemSettingsModel.findOne({ key: 'telegram.chatId' });

      const isEnabled = isEnabledSetting ? isEnabledSetting.value === true : true;
      const chatId = chatIdSetting ? chatIdSetting.value : null;

      console.log(`[TelegramChannelDebug] isEnabled: ${isEnabled}, botToken: ${botToken ? 'SET' : 'MISSING'}, chatId: ${chatId}`);

      if (!isEnabled || !botToken || !chatId) {
        outbox.status = 'PROCESSED';
        outbox.processedAt = new Date();
        await outbox.save();
        return true;
      }
      // 3. Susun isi pesan HTML gabungan (Perpaduan Format Deteksi & Detail Insiden)
      const port = process.env.PORT || 8080;
      const reportUrl = `http://localhost:${port}/dashboard/detections/${report.id}`;

      let statusText = 'Tidak Terindikasi';
      if (report.aiStatus === 'TINGGI') statusText = 'TINGGI';
      else if (report.aiStatus === 'SEDANG') statusText = 'SEDANG';
      else if (report.aiStatus === 'RENDAH') statusText = 'RENDAH';

      const pad = (n: number) => n.toString().padStart(2, '0');
      const date = new Date(report.timestamp);
      const yyyy = date.getFullYear();
      const mm = pad(date.getMonth() + 1);
      const dd = pad(date.getDate());
      const hh = pad(date.getHours());
      const min = pad(date.getMinutes());
      const ss = pad(date.getSeconds());
      const dateStr = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;

      const messageText = 
        `🚨 <b>Laporan Insiden Baru: #${report.id}</b>\n\n` +
        `<b>Lokasi:</b> ${report.location}\n` +
        `<b>Waktu:</b> ${dateStr}\n` +
        `<b>AI Status:</b> ${statusText} (${report.aiConfidence}%)\n` +
        `<b>Sumber:</b> ${report.sourceType}\n` +
        `<b>Keterangan:</b> ${report.additionalNotes}\n\n` +
        `<a href="${reportUrl}">Buka Laporan di Dashboard</a>`;

      // Baca file gambar bukti visual dari disk
      const imageRelativePath = report.image.startsWith('/') ? report.image : `/${report.image}`;
      const imagePath = path.join(process.cwd(), 'public', imageRelativePath);

      let response;
      if (fs.existsSync(imagePath)) {
        console.log(`[TelegramChannel] Uploading visual evidence: ${imagePath}`);
        const fileBuffer = fs.readFileSync(imagePath);
        const fileBlob = new Blob([fileBuffer], { type: 'image/jpeg' });

        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', fileBlob, path.basename(imagePath));
        formData.append('caption', messageText);
        formData.append('parse_mode', 'HTML');

        const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
        response = await fetch(url, {
          method: 'POST',
          body: formData
        });
      } else {
        console.log(`[TelegramChannel] Evidence file not found at ${imagePath}, falling back to sendMessage`);
        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: messageText,
            parse_mode: 'HTML',
            disable_web_page_preview: false
          })
        });
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API responded with status ${response.status}: ${errorText}`);
      }

      // 4. Perbarui status Outbox Event menjadi PROCESSED jika sukses
      outbox.status = 'PROCESSED';
      outbox.processedAt = new Date();
      await outbox.save();
      console.log(`[TelegramChannel] Telegram notification sent successfully for Report #${report.id}`);
      return true;

    } catch (err: any) {
      console.error(`[TelegramChannel] Failed to send Telegram notification for Report #${report.id}:`, err.message);
      
      // Perbarui status menjadi FAILED
      outbox.status = 'FAILED';
      await outbox.save();
      return false;
    }
  }
}
