"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateToken = generateToken;
exports.verifyToken = verifyToken;
const crypto_1 = __importDefault(require("crypto"));
const SECRET = process.env.JWT_SECRET || 'eyeco-secret-key';
function base64UrlEncode(str) {
    return (typeof str === 'string' ? Buffer.from(str) : str)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}
function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
}
function generateToken(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    // Add iat (issued-at) and a random jti so each login produces a unique token
    const fullPayload = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        jti: crypto_1.default.randomBytes(8).toString('hex'),
    };
    const part1 = base64UrlEncode(JSON.stringify(header));
    const part2 = base64UrlEncode(JSON.stringify(fullPayload));
    const hmac = crypto_1.default.createHmac('sha256', SECRET);
    hmac.update(`${part1}.${part2}`);
    const signature = base64UrlEncode(hmac.digest());
    return `${part1}.${part2}.${signature}`;
}
function verifyToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3)
            return null;
        const [part1, part2, signature] = parts;
        const hmac = crypto_1.default.createHmac('sha256', SECRET);
        hmac.update(`${part1}.${part2}`);
        const expectedSignature = base64UrlEncode(hmac.digest());
        if (signature !== expectedSignature)
            return null;
        return JSON.parse(base64UrlDecode(part2));
    }
    catch (err) {
        return null;
    }
}
