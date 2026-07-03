import crypto from "crypto";

export function encryptCctvPassword(text: string): string {
    const key = crypto.scryptSync(
        process.env.JWT_SECRET || "eyeco-secret-key",
        "salt",
        32
    );

    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(
        "aes-256-cbc",
        key,
        iv
    );

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    return iv.toString("hex") + ":" + encrypted;
}