"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const User_1 = require("../models/User");
const bcrypt_1 = __importDefault(require("bcrypt"));
class UserRepository {
    static async findById(id) {
        const user = await User_1.UserModel.findById(id).lean().exec();
        return user;
    }
    static async findByLegacyId(id) {
        const user = await User_1.UserModel.findOne({ id }).lean().exec();
        return user;
    }
    static async findByUsername(username) {
        const user = await User_1.UserModel.findOne({ username: username.toLowerCase() }).lean().exec();
        return user;
    }
    static async findByUsernameWithPassword(username) {
        const user = await User_1.UserModel.findOne({ username: username.toLowerCase() }).select('+passwordHash').lean().exec();
        return user;
    }
    static async getAllOfficers() {
        const officers = await User_1.UserModel.find({ role: 'officer' }).lean().exec();
        return officers;
    }
    /** Return all users (for admin management panel) */
    static async getAllUsers() {
        const users = await User_1.UserModel.find({}).sort({ createdAt: -1 }).lean().exec();
        return users;
    }
    /** Update a user's status by their numeric legacy id */
    static async updateStatus(id, status) {
        const user = await User_1.UserModel.findOneAndUpdate({ id }, { status }, { new: true }).lean().exec();
        return user;
    }
    static async create(username, passwordPlain, role, status = 'PENDING', extraFields) {
        try {
            const lowercaseUsername = username.toLowerCase();
            const exists = await User_1.UserModel.findOne({ username: lowercaseUsername }).lean().exec();
            if (exists)
                return null;
            const lastUser = await User_1.UserModel.findOne().sort({ id: -1 }).exec();
            const nextId = lastUser ? lastUser.id + 1 : 1;
            // Hash password using bcrypt (10 rounds is standard)
            const passwordHash = await bcrypt_1.default.hash(passwordPlain, 10);
            const newUser = await User_1.UserModel.create({
                id: nextId,
                username: lowercaseUsername,
                passwordHash,
                role,
                status,
                name: extraFields?.name || '',
                email: extraFields?.email || '',
                workspaceId: extraFields?.workspaceId
            });
            // return plain user object (passwordHash is select: false and not returned by toJSON)
            const result = newUser.toJSON();
            return result;
        }
        catch (err) {
            console.error('[DATABASE ERROR] createUser failed:', err);
            throw err;
        }
    }
    /**
     * Seed the default superadmin account if it doesn't exist.
     * admin_eyeco = superadmin (satu-satunya superadmin di sistem)
     */
    static async seedDefaultAdmin() {
        const superadminUsername = 'admin_eyeco';
        const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'admin123';
        const existing = await User_1.UserModel.findOne({ username: superadminUsername }).lean().exec();
        if (!existing) {
            await UserRepository.create(superadminUsername, superadminPassword, 'superadmin', 'APPROVED');
            console.log(`[DATABASE] Superadmin "${superadminUsername}" seeded successfully.`);
        }
        else if (existing.role !== 'superadmin') {
            // Jika sudah ada tapi role salah (misal admin), perbaiki ke superadmin
            const passwordHash = await bcrypt_1.default.hash(superadminPassword, 10);
            await User_1.UserModel.updateOne({ username: superadminUsername }, { role: 'superadmin', status: 'APPROVED', passwordHash });
            console.log(`[DATABASE] Superadmin "${superadminUsername}" role corrected to superadmin.`);
        }
        else if (existing.status !== 'APPROVED') {
            await User_1.UserModel.updateOne({ username: superadminUsername }, { status: 'APPROVED' });
            console.log(`[DATABASE] Superadmin "${superadminUsername}" status restored to APPROVED.`);
        }
    }
}
exports.UserRepository = UserRepository;
