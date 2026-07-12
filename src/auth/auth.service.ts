import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || 'eyeco-secret-key';

function base64UrlEncode(str: string | Buffer): string {
  return (typeof str === 'string' ? Buffer.from(str) : str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function generateToken(payload: { id: number; username: string; role: string }): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const part1 = base64UrlEncode(JSON.stringify(header));
  const part2 = base64UrlEncode(JSON.stringify(payload));
  
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(`${part1}.${part2}`);
  const signature = base64UrlEncode(hmac.digest());
  
  return `${part1}.${part2}.${signature}`;
}

export function verifyToken(token: string): { id: number; username: string; role: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [part1, part2, signature] = parts;
    const hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(`${part1}.${part2}`);
    const expectedSignature = base64UrlEncode(hmac.digest());
    
    if (signature !== expectedSignature) return null;
    
    return JSON.parse(base64UrlDecode(part2));
  } catch (err) {
    return null;
  }
}
