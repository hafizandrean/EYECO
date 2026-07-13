import { UserModel, IUser } from '../models/User';
import bcrypt from 'bcrypt';

export class UserRepository {
  public static async findByLegacyId(id: number, workspaceId?: number): Promise<IUser | null> {
    const query: any = { id };
    if (workspaceId !== undefined) {
      query.$or = [{ workspaceId }, { workspaceIds: workspaceId }];
    }
    const user = await UserModel.findOne(query).lean().exec();
    return user as IUser | null;
  }

  public static async findByUsername(identifier: string): Promise<IUser | null> {
    const lower = identifier.toLowerCase();
    const user = await UserModel.findOne({
      $or: [{ username: lower }, { email: lower }]
    }).lean().exec();
    return user as IUser | null;
  }

  public static async findByUsernameWithPassword(identifier: string): Promise<IUser | null> {
    const lower = identifier.toLowerCase();
    const user = await UserModel.findOne({
      $or: [{ username: lower }, { email: lower }]
    }).select('+passwordHash').lean().exec();
    return user as IUser | null;
  }

  public static async getAllUsers(workspaceId?: number): Promise<IUser[]> {
    const query: any = {};
    if (workspaceId !== undefined) {
      query.$or = [{ workspaceId }, { workspaceIds: workspaceId }];
    }
    const users = await UserModel.find(query).sort({ createdAt: -1 }).lean().exec();
    return users as IUser[];
  }

  public static async updateStatus(
    id: number,
    status: 'APPROVED' | 'REJECTED',
    workspaceId?: number
  ): Promise<IUser | null> {
    const query: any = { id };
    if (workspaceId !== undefined) {
      query.$or = [{ workspaceId }, { workspaceIds: workspaceId }];
    }
    const user = await UserModel.findOneAndUpdate(
      query,
      { status },
      { new: true }
    ).lean().exec();
    return user as IUser | null;
  }

  public static async create(
    username: string,
    passwordPlain: string,
    role: 'superadmin' | 'admin' | 'user',
    status: 'PENDING' | 'APPROVED' = 'PENDING',
    extraFields?: {
      name?: string;
      email?: string;
      phone?: string;
      workspaceId?: number;
      workspaceIds?: number[];
    }
  ): Promise<IUser | null> {
    try {
      const lowercaseUsername = username.toLowerCase();
      const exists = await UserModel.findOne({ username: lowercaseUsername }).lean().exec();
      if (exists) return null;

      const lastUser = await UserModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastUser ? lastUser.id + 1 : 1;

      const passwordHash = await bcrypt.hash(passwordPlain, 10);

      const newUser = await UserModel.create({
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
      return result as IUser;
    } catch (err) {
      console.error('[DATABASE ERROR] createUser failed:', err);
      throw err;
    }
  }
}
