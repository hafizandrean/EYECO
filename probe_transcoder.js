// probe transcoder lokal: tes RTSP→HLS dari Tuya dengan ffmpeg lokal, perangkat online
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RTSP = process.argv[2];
const outDir = '/tmp/hls_probe';
if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const ffmpeg = '/opt/homebrew/bin/ffmpeg';
const m3u8 = path.join(outDir, 'stream.m3u8').replace(/\\/g, '/');
const seg = path.join(outDir, 'seg%03d.ts').replace(/\\/g, '/');

const args = ['-loglevel', 'warning', '-rtsp_transport', 'tcp', '-i', RTSP,
  '-c:v', 'copy', '-an', '-f', 'hls', '-hls_time', '1', '-hls_list_size', '15',
  '-hls_flags', 'delete_segments+append_list+omit_endlist+temp_file',
  '-hls_allow_cache', '0', '-hls_segment_filename', seg, m3u8];

console.log('SPAWN:', ffmpeg, args.slice(0, 5).join(' '));
const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
proc.stderr.on('data', d => { stderr += d.toString(); });
proc.on('error', e => console.log('SPAWN ERR', e.message));

const deadline = Date.now() + 35000;
const check = setInterval(() => {
  let ok = false;
  try { ok = /\.ts/.test(fs.readFileSync(m3u8, 'utf8')); } catch {}
  if (ok) {
    clearInterval(check);
    console.log('SEGMENT_OK');
    console.log('PLAYLIST:', fs.readFileSync(m3u8, 'utf8').slice(0, 200));
    proc.kill('SIGKILL');
    process.exit(0);
  }
  if (Date.now() > deadline) {
    clearInterval(check);
    console.log('TIMEOUT_30S_NO_SEGMENT');
    console.log('STDERR tail:', stderr.slice(-600));
    proc.kill('SIGKILL');
    process.exit(1);
  }
}, 1000);