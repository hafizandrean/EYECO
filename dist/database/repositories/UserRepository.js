"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const User_1 = require("../models/User");
const bcrypt_1 = __importDefault(require("bcrypt"));
class UserRepository {
    static async findByLegacyId(id, workspaceId) {
        const query = { id };
        if (workspaceId !== undefined) {
            query.$or = [{ workspaceId }, { workspaceIds: workspaceId }];
        }
        const user = await User_1.UserModel.findOne(query).lean().exec();
        return user;
    }
    static async findByUsername(identifier) {
        const lower = identifier.toLowerCase();
        const user = await User_1.UserModel.findOne({
            $or: [{ username: lower }, { email: lower }]
        }).lean().exec();
        return user;
    }
    static async findByUsernameWithPassword(identifier) {
        const lower = identifier.toLowerCase();
        const user = await User_1.UserModel.findOne({
            $or: [{ username: lower }, { email: lower }]
        }).select('+passwordHash').lean().exec();
        return user;
    }
    static async getAllUsers(workspaceId) {
        const query = {};
        if (workspaceId !== undefined) {
            query.$or = [{ workspaceId }, { workspaceIds: workspaceId }];
        }
        const users = await User_1.UserModel.find(query).sort({ createdAt: -1 }).lean().exec();
        return users;
    }
    static async updateStatus(id, status, workspaceId) {
        const query = { id };
        if (workspaceId !== undefined) {
            query.$or = [{ workspaceId }, { workspaceIds: workspaceId }];
        }
        const user = await User_1.UserModel.findOneAndUpdate(query, { status }, { new: true }).lean().exec();
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
            const passwordHash = await bcrypt_1.default.hash(passwordPlain, 10);
            const newUser = await User_1.UserModel.create({
                id: nextId,
                username: lowercaseUsername,
                passwordHash,
                role,
                status,
                name: extraFields?.name || '',
                email: extraFields?.email || '',
                phone: extraFields?.phone || '',
                workspaceId: extraFields?.workspaceId,
                workspaceIds: extraFields?.workspaceIds || (extraFields?.workspaceId ? [extraFields.workspaceId] : [])
            });
            const result = newUser.toJSON();
            return result;
        }
        catch (err) {
            console.error('[DATABASE ERROR] createUser failed:', err);
            throw err;
        }
    }
}
exports.UserRepository = UserRepository;
