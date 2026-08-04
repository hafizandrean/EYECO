"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramNotificationChannel = void 0;
const SystemSettings_1 = require("../database/models/SystemSettings");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class TelegramNotificationChannel {
    name = 'Telegram';
    async send(report) {
        try {
            // 1. Ambil token bot dan chat ID dari environment / database
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const isEnabledSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.enabled' });
            const chatIdSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.chatId' });
            // Fix: handle both boolean true and string "true" from Mixed schema type
            const isEnabled = isEnabledSetting
                ? (isEnabledSetting.value === true || isEnabledSetting.value === 'true')
                : true;
            const chatId = chatIdSetting ? String(chatIdSetting.value) : null;
            console.log(`[TelegramChannel] isEnabled: ${isEnabled}, botToken: ${botToken ? 'SET' : 'MISSING'}, chatId: ${chatId}`);
            if (!isEnabled) {
                console.log('[TelegramChannel] Telegram notifications disabled in settings. Skipping.');
                return true;
            }
            if (!botToken) {
                console.error('[TelegramChannel] TELEGRAM_BOT_TOKEN not set in .env. Cannot send.');
                return false;
            }
            if (!chatId || chatId === 'null' || chatId === 'undefined') {
                console.error('[TelegramChannel] telegram.chatId not configured in system settings. Cannot send.');
                return false;
            }
            // 2. Susun isi pesan HTML gabungan (Perpaduan Format Deteksi & Detail Insiden)
            const port = process.env.PORT || 8080;
            const reportUrl = `http://localhost:${port}/dashboard/detections/${report.id}`;
            let statusText = 'Tidak Terindikasi';
            if (report.aiStatus === 'TINGGI')
                statusText = '🔴 TINGGI';
            else if (report.aiStatus === 'SEDANG')
                statusText = '🟡 SEDANG';
            else if (report.aiStatus === 'RENDAH')
                statusText = '🟢 RENDAH';
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
            console.log(`[TelegramChannel] Telegram notification sent successfully for Report #${report.id}`);
            return true;
        }
        catch (err) {
            console.error(`[TelegramChannel] Failed to send Telegram notification for Report #${report.id}:`, err.message);
            return false;
        }
    }
}
exports.TelegramNotificationChannel = TelegramNotificationChannel;
