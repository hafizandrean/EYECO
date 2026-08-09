#!/bin/bash
# EYECO deploy bootstrap — jalankan sebagai root di VPS Hostinger (Ubuntu 24.04)
# Cara pakai: sudo bash eyeco-deploy.sh
set -euo pipefail

DOMAIN="${1:-eyeco.tech}"
APP_DIR=/opt/eyeco
PORT=8000
REPO="https://github.com/hafizandrean/EYECO.git"
BRANCH="cyber-squad"

echo "==> [1/7] Update & install dependencies"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx git curl ca-certificates build-essential ffmpeg

echo "==> [2/7] Install Node.js 20"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [3/7] Clone repo (branch $BRANCH)"
# Backup .env lama supaya tidak hilang saat re-run
if [ -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env" /tmp/eyeco-env-backup
  echo "    .env lama disimpan ke /tmp/eyeco-env-backup"
fi
rm -rf "$APP_DIR"
git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
cd "$APP_DIR"
# Repo has tracked node_modules/.bin/tsx (broken) — hapus sebelum npm install
rm -rf node_modules
if [ -f /tmp/eyeco-env-backup ]; then
  mv /tmp/eyeco-env-backup "$APP_DIR/.env"
  echo "    .env dipulihkan"
fi

echo "==> [4/7] .env — EDIT INI!"
if [ ! -f .env ]; then
  cat > .env <<'ENVEOF'
# ===== WAJIB DIISI =====
PORT=8000
NODE_ENV=production
MONGODB_URI=mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net
DB_NAME=eyeco
JWT_SECRET=GANTI_DENGAN_STRING_ACAK_PANJANG
SESSION_SECRET=GANTI_DENGAN_STRING_ACAK_LAIN
# Telegram bot (opsional)
TELEGRAM_BOT_TOKEN=
# Tuya CCTV (opsional)
TUYA_CLIENT_ID=
TUYA_CLIENT_SECRET=
TUYA_API_ENDPOINT=
# Cloudflare R2 (opsional — foto disimpan di R2)
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=
R2_BUCKET=eyeco-files
R2_PUBLIC_URL=
AI_SNAPSHOT_REQUIRED_FROM=
ENVEOF
  echo "    .env dibuat — ISI SEKARANG: nano $APP_DIR/.env"
fi

echo "==> [5/7] npm install & build"
cd "$APP_DIR"
# Build butuh typescript (devDep) — install penuh, prune dev setelah build
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
npm run build
npm prune --omit=dev --no-audit --no-fund 2>/dev/null || true

echo "==> [6/7] PM2 daemon"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
mkdir -p "$APP_DIR/public/hls"  # folder HLS untuk CCTV streaming
pm2 delete eyeco 2>/dev/null || true
pm2 start dist/server.js --name eyeco --cwd "$APP_DIR"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 || true

echo "==> [7/7] Nginx + SSL"
cat > /etc/nginx/sites-available/eyeco <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/eyeco /etc/nginx/sites-enabled/eyeco
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Firewall
ufw allow OpenSSH 2>/dev/null || ufw allow 22/tcp
ufw allow 80/tcp; ufw allow 443/tcp
ufw --force enable

# SSL Let's Encrypt (butuh DNS sudah mengarah ke IP VPS!)
if command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1; then
  certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect 2>/dev/null \
    && echo "SSL OK" || echo "SSL SKIP — jalankan nanti: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
fi

echo ""
echo "================================================"
echo " SELESAI! App jalan di http://127.0.0.1:$PORT"
echo " Domain: https://$DOMAIN (setelah DNS + SSL)"
echo ""
echo " YANG BELUM DILAKUKAN (manual, butuh akun lu):"
echo " 1. Isi .env:  nano $APP_DIR/.env  → pm2 restart eyeco"
echo " 2. DNS hPanel: A @ & www -> IP VPS ini: $(curl -s4 ifconfig.me)"
echo " 3. MongoDB Atlas: Network Access -> whitelist IP VPS ini"
echo "================================================"