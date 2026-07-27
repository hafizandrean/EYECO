const fs = require('fs');
const src = fs.readFileSync('public/js/pages/cctv-monitoring.js', 'utf8');

// More robust counting: properly handle template literals with ${}
let b = 0;
let bracesByLine = [];
let inStr = null;

for (let i = 0; i < src.length; i++) {
  const c = src[i];
  const prev = i > 0 ? src[i-1] : '';
  
  if (inStr) {
    if (c === inStr && prev !== '\\') {
      inStr = null;
    } else if (inStr === '`' && c === '{' && prev === '$') {
      // Template literal ${...} - we're entering a JS expression inside template
      // This opens a new string-context. But for simplicity, just count { as brace
      // Actually let me think about this...
      // In template literal `...${...}...`, the ${ starts a JS expression.
      // The `}` closes it. But `}` in `...` doesn't close anything.
      // This is complex. Let me just count braces but skip template literals entirely.
    }
    continue;
  } else if (c === '/' && src[i+1] === '/') {
    // Single line comment - skip to end of line
    while (i < src.length && src[i] !== '\n') i++;
    continue;
  } else if (c === '/' && src[i+1] === '*') {
    // Multi-line comment
    i += 2;
    while (i < src.length && !(src[i] === '*' && src[i+1] === '/')) i++;
    i++;
    continue;
  } else if ((c === '"' || c === "'" || c === '`') && prev !== '\\') {
    inStr = c;
    continue;
  }
  
  if (c === '{') b++;
  if (c === '}') b--;
  if (c === '\n') bracesByLine.push(b);
}

console.log('Final brace balance:', b);
console.log('First 20 brace-by-line:', bracesByLine.slice(0,20));
console.log('Last 20 brace-by-line:', bracesByLine.slice(-20));

// Find where brace drops below 0
for (let i = 0; i < bracesByLine.length; i++) {
  if (bracesByLine[i] < 0) {
    console.log(`Negative at line ${i+1}: ${bracesByLine[i]}`);
  }
}
