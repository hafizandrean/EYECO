const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const input = 'D:\\Documents\\GitHub\\EYECO\\public\\hls\\a34008d066e4497aaeg9yw\\stream.m3u8';
const output = 'D:\\Documents\\GitHub\\EYECO\\public\\uploads\\cctv_capture_1.jpg';

const ffmpegPath = require('ffmpeg-static');
console.log('ffmpegPath:', ffmpegPath);
console.log('input exists:', fs.existsSync(input));

const args = [
  '-y',
  '-ss', '00:00:00',
  '-i', input,
  '-vframes', '1',
  '-f', 'image2',
  output
];

console.log('Running:', ffmpegPath, args.join(' '));

const child = spawn(ffmpegPath || 'ffmpeg', args, { windowsHide: true });

let stderr = '';
child.stderr.on('data', (data) => {
  stderr += data.toString();
});

let stdout = '';
child.stdout.on('data', (data) => {
  stdout += data.toString();
});

child.on('close', (code) => {
  console.log('Exit code:', code);
  console.log('Stdout:', stdout);
  console.log('Stderr:', stderr);
  console.log('Output exists:', fs.existsSync(output));
});
