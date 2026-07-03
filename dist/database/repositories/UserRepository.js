"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserRepository = void 0;
const User_1 = require("../models/User");
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
    static async getAllOfficers() {
        const officers = await User_1.UserModel.find({ role: 'officer' }).lean().exec();
        return officers;
    }
}
exports.UserRepository = UserRepository;
