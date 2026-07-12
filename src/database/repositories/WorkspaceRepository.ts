import { WorkspaceModel, IWorkspace } from '../models/Workspace';
import crypto from 'crypto';

// Generate a unique workspace code like WS-4J91KD
async function generateUniqueCode(): Promise<string> {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 25; attempt++) {
    let code = '';
    code = 'WS-';
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const existing = await WorkspaceModel.findOne({ code }).lean().exec();
    if (!existing) return code;
  }
  throw new Error('Gagal membuat kode workspace unik');
}

export class WorkspaceRepository {
  /**
   * Create a new workspace (with auto-generated code and adminIds array)
   */
  public static async create(params: {
    name: string;
    company?: string;
    address?: string;
    description?: string;
    superadminId?: number;
    adminIds?: number[];
  }): Promise<IWorkspace> {
    const existingName = await WorkspaceModel.findOne({ name: params.name.trim() }).lean().exec();
    if (existingName) {
      throw new Error('Nama workspace sudah digunakan');
    }

    const lastWorkspace = await WorkspaceModel.findOne().sort({ id: -1 }).exec();
    const nextId = lastWorkspace ? lastWorkspace.id + 1 : 1;

    const code = await generateUniqueCode();

    const workspace = await WorkspaceModel.create({
      id: nextId,
      code,
      name: params.name.trim(),
      company: (params.company || '').trim(),
      address: (params.address || '').trim(),
      description: (params.description || '').trim(),
      superadminId: params.superadminId,
      adminIds: params.adminIds || [],
    });

    return workspace.toJSON() as IWorkspace;
  }

  /**
   * Update an existing workspace by numeric id
   */
  public static async update(
    id: number,
    params: {
      name?: string;
      company?: string;
      address?: string;
      description?: string;
    }
  ): Promise<IWorkspace | null> {
    const workspace = await WorkspaceModel.findOne({ id });
    if (!workspace) return null;

    if (params.name !== undefined) workspace.name = params.name.trim();
    if (params.company !== undefined) workspace.company = params.company.trim();
    if (params.address !== undefined) workspace.address = params.address.trim();
    if (params.description !== undefined) workspace.description = params.description.trim();

    await workspace.save();
    return workspace.toJSON() as IWorkspace;
  }

  /**
   * Delete a workspace by numeric id
   */
  public static async delete(id: number): Promise<boolean> {
    const deleted = await WorkspaceModel.findOneAndDelete({ id });
    return !!deleted;
  }

  /**
   * Find all workspaces, sorted by newest
   */
  public static async findAll(): Promise<IWorkspace[]> {
    const workspaces = await WorkspaceModel.find({}).sort({ createdAt: -1 }).lean().exec();
    return workspaces as IWorkspace[];
  }

  /**
   * Find workspaces owned by a superadmin
   */
  public static async findBySuperadmin(superadminId: number): Promise<IWorkspace[]> {
    const workspaces = await WorkspaceModel.find({ superadminId }).sort({ createdAt: -1 }).lean().exec();
    return workspaces as IWorkspace[];
  }

  /**
   * Find a workspace by numeric id
   */
  public static async findById(id: number): Promise<IWorkspace | null> {
    const workspace = await WorkspaceModel.findOne({ id }).lean().exec();
    return workspace as IWorkspace | null;
  }

  /**
   * Add admin to workspace (enforces max 3 limit)
   */
  public static async addAdmin(workspaceId: number, adminId: number): Promise<boolean> {
    const ws = await WorkspaceModel.findOne({ id: workspaceId });
    if (!ws) return false;
    
    if (ws.adminIds && ws.adminIds.length >= 3) {
      throw new Error('Batas maksimal 3 Admin per Workspace telah tercapai');
    }
    
    await WorkspaceModel.updateOne({ id: workspaceId }, { $addToSet: { adminIds: adminId } });
    return true;
  }

  /**
   * Remove admin from workspace
   */
  public static async removeAdmin(workspaceId: number, adminId: number): Promise<boolean> {
    await WorkspaceModel.updateOne({ id: workspaceId }, { $pull: { adminIds: adminId } });
    return true;
  }
}
