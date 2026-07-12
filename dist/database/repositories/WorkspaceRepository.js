"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceRepository = void 0;
const Workspace_1 = require("../models/Workspace");
// Generate a unique workspace code like WS-4J91KD
async function generateUniqueCode() {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 25; attempt++) {
        let code = '';
        code = 'WS-';
        for (let i = 0; i < 6; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        const existing = await Workspace_1.WorkspaceModel.findOne({ code }).lean().exec();
        if (!existing)
            return code;
    }
    throw new Error('Gagal membuat kode workspace unik');
}
class WorkspaceRepository {
    /**
     * Create a new workspace (with auto-generated code and adminIds array)
     */
    static async create(params) {
        const existingName = await Workspace_1.WorkspaceModel.findOne({ name: params.name.trim() }).lean().exec();
        if (existingName) {
            throw new Error('Nama workspace sudah digunakan');
        }
        const lastWorkspace = await Workspace_1.WorkspaceModel.findOne().sort({ id: -1 }).exec();
        const nextId = lastWorkspace ? lastWorkspace.id + 1 : 1;
        const code = await generateUniqueCode();
        const workspace = await Workspace_1.WorkspaceModel.create({
            id: nextId,
            code,
            name: params.name.trim(),
            company: (params.company || '').trim(),
            address: (params.address || '').trim(),
            description: (params.description || '').trim(),
            superadminId: params.superadminId,
            adminIds: params.adminIds || [],
        });
        return workspace.toJSON();
    }
    /**
     * Update an existing workspace by numeric id
     */
    static async update(id, params) {
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id });
        if (!workspace)
            return null;
        if (params.name !== undefined)
            workspace.name = params.name.trim();
        if (params.company !== undefined)
            workspace.company = params.company.trim();
        if (params.address !== undefined)
            workspace.address = params.address.trim();
        if (params.description !== undefined)
            workspace.description = params.description.trim();
        await workspace.save();
        return workspace.toJSON();
    }
    /**
     * Delete a workspace by numeric id
     */
    static async delete(id) {
        const deleted = await Workspace_1.WorkspaceModel.findOneAndDelete({ id });
        return !!deleted;
    }
    /**
     * Find all workspaces, sorted by newest
     */
    static async findAll() {
        const workspaces = await Workspace_1.WorkspaceModel.find({}).sort({ createdAt: -1 }).lean().exec();
        return workspaces;
    }
    /**
     * Find workspaces owned by a superadmin
     */
    static async findBySuperadmin(superadminId) {
        const workspaces = await Workspace_1.WorkspaceModel.find({ superadminId }).sort({ createdAt: -1 }).lean().exec();
        return workspaces;
    }
    /**
     * Find a workspace by numeric id
     */
    static async findById(id) {
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id }).lean().exec();
        return workspace;
    }
    /**
     * Add admin to workspace (enforces max 3 limit)
     */
    static async addAdmin(workspaceId, adminId) {
        const ws = await Workspace_1.WorkspaceModel.findOne({ id: workspaceId });
        if (!ws)
            return false;
        if (ws.adminIds && ws.adminIds.length >= 3) {
            throw new Error('Batas maksimal 3 Admin per Workspace telah tercapai');
        }
        await Workspace_1.WorkspaceModel.updateOne({ id: workspaceId }, { $addToSet: { adminIds: adminId } });
        return true;
    }
    /**
     * Remove admin from workspace
     */
    static async removeAdmin(workspaceId, adminId) {
        await Workspace_1.WorkspaceModel.updateOne({ id: workspaceId }, { $pull: { adminIds: adminId } });
        return true;
    }
}
exports.WorkspaceRepository = WorkspaceRepository;
