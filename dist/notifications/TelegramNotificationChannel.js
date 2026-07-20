"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramNotificationChannel = void 0;
const OutboxEvent_1 = require("../database/models/OutboxEvent");
const SystemSettings_1 = require("../database/models/SystemSettings");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class TelegramNotificationChannel {
    name = 'Telegram';
    async send(report) {
        // 1. Simpan Outbox Event berstatus PENDING
        const outbox = await OutboxEvent_1.OutboxEventModel.create({
            aggregateType: 'Report',
            aggregateId: report._id.toString(),
            eventType: 'IncidentCreated',
            payload: report.toJSON(),
            status: 'PENDING'
        });
        try {
            // 2. Ambil token bot dan chat ID dari environment / database
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const isEnabledSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.enabled' });
            const chatIdSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.chatId' });
            const isEnabled = isEnabledSetting ? isEnabledSetting.value === true : true;
            const chatId = chatIdSetting ? chatIdSetting.value : null;
            const logMsg = `[${new Date().toISOString()}] Report #${report.id} | isEnabled: ${isEnabled} | botToken: ${botToken ? 'SET' : 'MISSING'} | chatId: ${chatId}\n`;
            fs_1.default.appendFileSync(path_1.default.join(process.cwd(), 'telegram_debug.log'), logMsg);
            console.log(`[TelegramChannelDebug] isEnabled: ${isEnabled}, botToken: ${botToken ? 'SET' : 'MISSING'}, chatId: ${chatId}`);
            if (!isEnabled || !botToken || !chatId) {
                console.log('[TelegramChannel] Telegram notification is disabled or not configured.');
                outbox.status = 'PROCESSED';
                outbox.processedAt = new Date();
                await outbox.save();
                return true;
            }
            // 3. Susun isi pesan HTML gabungan (Perpaduan Format Deteksi & Detail Insiden)
            const port = process.env.PORT || 8080;
            const reportUrl = `http://localhost:${port}/dashboard/detections/${report.id}`;
            let statusText = 'Tidak Terindikasi';
            if (report.aiStatus === 'TINGGI')
                statusText = 'TINGGI';
            else if (report.aiStatus === 'SEDANG')
                statusText = 'SEDANG';
            else if (report.aiStatus === 'RENDAH')
                statusText = 'RENDAH';
            const pad = (n) => n.toString().padStart(2, '0');
            const date = new Date(report.timestamp);
            const yyyy = date.getFullYear();
            const mm = pad(date.getMonth() + 1);
            const dd = pad(date.getDate());
            const hh = pad(date.getHours());
            const min = pad(date.getMinutes());
            const ss = pad(date.getSeconds());
            const dateStr = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
            const messageText = `🚨 <b>Laporan Insiden Baru: #${report.id}</b>\n\n` +
                `<b>Lokasi:</b> ${report.location}\n` +
                `<b>Waktu:</b> ${dateStr}\n` +
                `<b>AI Status:</b> ${statusText} (${report.aiConfidence}%)\n` +
                `<b>Sumber:</b> ${report.sourceType}\n` +
                `<b>Keterangan:</b> ${report.additionalNotes}\n\n` +
                `<a href="${reportUrl}">Buka Laporan di Dashboard</a>`;
            // Baca file gambar bukti visual dari disk
            const imageRelativePath = report.image.startsWith('/') ? report.image : `/${report.image}`;
            const imagePath = path_1.default.join(process.cwd(), 'public', imageRelativePath);
            let response;
            if (fs_1.default.existsSync(imagePath)) {
                console.log(`[TelegramChannel] Uploading visual evidence: ${imagePath}`);
                const fileBuffer = fs_1.default.readFileSync(imagePath);
                const fileBlob = new Blob([fileBuffer], { type: 'image/jpeg' });
                const formData = new FormData();
                formData.append('chat_id', chatId);
                formData.append('photo', fileBlob, path_1.default.basename(imagePath));
                formData.append('caption', messageText);
                formData.append('parse_mode', 'HTML');
                const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
                response = await fetch(url, {
                    method: 'POST',
                    body: formData
                });
            }
            else {
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
            fs_1.default.appendFileSync(path_1.default.join(process.cwd(), 'telegram_debug.log'), `[${new Date().toISOString()}] Telegram API success for Report #${report.id}\n`);
            // 4. Perbarui status Outbox Event menjadi PROCESSED jika sukses
            outbox.status = 'PROCESSED';
            outbox.processedAt = new Date();
            await outbox.save();
            console.log(`[TelegramChannel] Telegram notification sent successfully for Report #${report.id}`);
            return true;
        }
        catch (err) {
            console.error(`[TelegramChannel] Failed to send Telegram notification for Report #${report.id}:`, err.message);
            // Perbarui status menjadi FAILED
            outbox.status = 'FAILED';
            await outbox.save();
            return false;
        }
    }
}
exports.TelegramNotificationChannel = TelegramNotificationChannel;
