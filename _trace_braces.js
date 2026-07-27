const fs = require('fs');
const src = fs.readFileSync('public/js/pages/cctv-monitoring.js', 'utf8');
const lines = src.split('\n');
let b = 0;
let inStr = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    const p = j > 0 ? line[j - 1] : '';
    if (inStr) {
      if (c === inStr && p !== '\\') inStr = null;
    } else {
      if (c === '/' && line[j + 1] === '/') break;
      if ((c === '"' || c === "'" || c === '`') && p !== '\\') inStr = c;
      if (c === '{') b++;
      if (c === '}') b--;
    }
  }
  // Print around key areas
  if ((i >= 978 && i <= 1010) || (i >= 1295 && i <= 1310) || (i >= 1430 && i <= 1480) || (i >= 1500 && i <= 1520) || (i >= 1615 && i <= 1637)) {
    console.log(`L${i+1} b=${b} | ${line.substring(0, 70)}`);
  }
  if (b < 0) {
    console.log(`*** NEGATIVE at L${i+1}: ${line.substring(0, 70)}`);
    b = 0;
  }
}
console.log(`Final: ${b}`);
