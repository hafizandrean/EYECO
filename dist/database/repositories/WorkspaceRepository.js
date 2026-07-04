"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceRepository = void 0;
const Workspace_1 = require("../models/Workspace");
class WorkspaceRepository {
    /**
     * Create a new workspace
     */
    static async create(params) {
        const lastWorkspace = await Workspace_1.WorkspaceModel.findOne().sort({ id: -1 }).exec();
        const nextId = lastWorkspace ? lastWorkspace.id + 1 : 1;
        const workspace = await Workspace_1.WorkspaceModel.create({
            id: nextId,
            name: params.name.trim(),
            company: (params.company || '').trim(),
            address: (params.address || '').trim(),
            description: (params.description || '').trim(),
            adminId: params.adminId
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
        if (params.adminId !== undefined)
            workspace.adminId = params.adminId;
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
     * Find a workspace by numeric id
     */
    static async findById(id) {
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id }).lean().exec();
        return workspace;
    }
}
exports.WorkspaceRepository = WorkspaceRepository;
