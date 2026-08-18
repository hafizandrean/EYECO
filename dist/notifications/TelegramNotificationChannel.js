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
            const isEnabledSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.enabled' });
            const chatIdSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.chatId' });
            const botTokenSetting = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'telegram.botToken' });
            const botToken = (botTokenSetting?.value ? String(botTokenSetting.value).trim() : '') || process.env.TELEGRAM_BOT_TOKEN;
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
            // 3. Resolve file gambar bukti visual dari disk lokal (dengan multi-folder fallback)
            let fileBuffer = null;
            let filename = 'evidence.jpg';
            // Direct path check
            const defaultPath = path_1.default.join(process.cwd(), 'public', report.image.startsWith('/') ? report.image : `/${report.image}`);
            if (fs_1.default.existsSync(defaultPath) && fs_1.default.statSync(defaultPath).isFile()) {
                fileBuffer = fs_1.default.readFileSync(defaultPath);
                filename = path_1.default.basename(defaultPath);
            }
            else {
                // Multi-location search in uploads/
                const baseName = path_1.default.basename(report.image);
                const uploadsDir = path_1.default.join(process.cwd(), 'public', 'uploads');
                const candidates = [
                    path_1.default.join(uploadsDir, baseName),
                    path_1.default.join(uploadsDir, 'reports', String(report.id), baseName),
                    path_1.default.join(uploadsDir, 'laporan_manual', baseName),
                    path_1.default.join(uploadsDir, 'laporan_auto', baseName)
                ];
                for (const cand of candidates) {
                    if (fs_1.default.existsSync(cand) && fs_1.default.statSync(cand).isFile()) {
                        fileBuffer = fs_1.default.readFileSync(cand);
                        filename = baseName;
                        break;
                    }
                }
                // Subdirectories search under uploads/reports/
                if (!fileBuffer) {
                    const reportsDir = path_1.default.join(uploadsDir, 'reports');
                    if (fs_1.default.existsSync(reportsDir)) {
                        try {
                            const subdirs = fs_1.default.readdirSync(reportsDir);
                            for (const sub of subdirs) {
                                const cand = path_1.default.join(reportsDir, sub, baseName);
                                if (fs_1.default.existsSync(cand) && fs_1.default.statSync(cand).isFile()) {
                                    fileBuffer = fs_1.default.readFileSync(cand);
                                    filename = baseName;
                                    break;
                                }
                            }
                        }
                        catch (_) { }
                    }
                }
            }
            // If still not found locally, fetch via HTTP internal proxy
            if (!fileBuffer) {
                try {
                    const baseName = path_1.default.basename(report.image);
                    const fetchUrl = `http://localhost:${port}/uploads/${baseName}`;
                    console.log(`[TelegramChannel] Local file not found on disk, fetching from ${fetchUrl}...`);
                    const imgRes = await fetch(fetchUrl);
                    if (imgRes.ok) {
                        fileBuffer = Buffer.from(await imgRes.arrayBuffer());
                        filename = baseName;
                    }
                }
                catch (fetchErr) {
                    console.warn('[TelegramChannel] Could not fetch image via HTTP:', fetchErr.message);
                }
            }
            let response;
            if (fileBuffer && fileBuffer.length > 0) {
                console.log(`[TelegramChannel] Sending photo evidence to Telegram (${filename}, ${fileBuffer.length} bytes)...`);
                const fileBlob = new Blob([new Uint8Array(fileBuffer)], { type: 'image/jpeg' });
                const formData = new FormData();
                formData.append('chat_id', chatId);
                formData.append('photo', fileBlob, filename);
                formData.append('caption', messageText);
                formData.append('parse_mode', 'HTML');
                const url = `https://api.telegram.org/bot${botToken}/sendPhoto`;
                response = await fetch(url, {
                    method: 'POST',
                    body: formData
                });
            }
            else {
                console.warn(`[TelegramChannel] Evidence photo unavailable for Report #${report.id}, sending text-only message.`);
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
