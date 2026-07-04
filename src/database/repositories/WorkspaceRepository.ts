import { WorkspaceModel, IWorkspace } from '../models/Workspace';

export class WorkspaceRepository {
  /**
   * Create a new workspace
   */
  public static async create(params: {
    name: string;
    company?: string;
    address?: string;
    description?: string;
    adminId?: number;
  }): Promise<IWorkspace> {
    const lastWorkspace = await WorkspaceModel.findOne().sort({ id: -1 }).exec();
    const nextId = lastWorkspace ? lastWorkspace.id + 1 : 1;

    const workspace = await WorkspaceModel.create({
      id: nextId,
      name: params.name.trim(),
      company: (params.company || '').trim(),
      address: (params.address || '').trim(),
      description: (params.description || '').trim(),
      adminId: params.adminId
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
      adminId?: number;
    }
  ): Promise<IWorkspace | null> {
    const workspace = await WorkspaceModel.findOne({ id });
    if (!workspace) return null;

    if (params.name !== undefined) workspace.name = params.name.trim();
    if (params.company !== undefined) workspace.company = params.company.trim();
    if (params.address !== undefined) workspace.address = params.address.trim();
    if (params.description !== undefined) workspace.description = params.description.trim();
    if (params.adminId !== undefined) workspace.adminId = params.adminId;

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
   * Find a workspace by numeric id
   */
  public static async findById(id: number): Promise<IWorkspace | null> {
    const workspace = await WorkspaceModel.findOne({ id }).lean().exec();
    return workspace as IWorkspace | null;
  }
}
