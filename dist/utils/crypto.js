"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptCctvPassword = encryptCctvPassword;
const crypto_1 = __importDefault(require("crypto"));
function encryptCctvPassword(text) {
    const key = crypto_1.default.scryptSync(process.env.JWT_SECRET || "eyeco-secret-key", "salt", 32);
    const iv = crypto_1.default.randomBytes(16);
    const cipher = crypto_1.default.createCipheriv("aes-256-cbc", key, iv);
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
}
