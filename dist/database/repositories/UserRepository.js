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
    static async create(username, passwordPlain, role, status = 'PENDING') {
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
                status
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
    /** Seed the default admin and super admin accounts if they don't exist. */
    static async seedDefaultAdmin() {
        const existing = await User_1.UserModel.findOne({ username: 'admin_eyeco' }).lean().exec();
        if (!existing) {
            await UserRepository.create('admin_eyeco', 'admin123', 'admin', 'APPROVED');
            console.log('[DATABASE] Default admin user "admin_eyeco" seeded successfully.');
        }
        else if (existing.status !== 'APPROVED') {
            // Ensure the default admin is always APPROVED
            await User_1.UserModel.updateOne({ username: 'admin_eyeco' }, { status: 'APPROVED' });
            console.log('[DATABASE] Default admin user "admin_eyeco" status restored to APPROVED.');
        }
        const existingSuper = await User_1.UserModel.findOne({ username: 'superadmin' }).lean().exec();
        if (!existingSuper) {
            await UserRepository.create('superadmin', 'superadmin123', 'superadmin', 'APPROVED');
            console.log('[DATABASE] Super Admin user "superadmin" seeded successfully.');
        }
        else if (existingSuper.status !== 'APPROVED') {
            await User_1.UserModel.updateOne({ username: 'superadmin' }, { status: 'APPROVED' });
            console.log('[DATABASE] Super Admin user "superadmin" status restored to APPROVED.');
        }
    }
}
exports.UserRepository = UserRepository;
