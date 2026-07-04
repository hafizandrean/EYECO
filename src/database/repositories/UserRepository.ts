import { UserModel, IUser } from '../models/User';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

export class UserRepository {
  public static async findById(id: mongoose.Types.ObjectId | string): Promise<IUser | null> {
    const user = await UserModel.findById(id).lean().exec();
    return user as IUser | null;
  }

  public static async findByLegacyId(id: number): Promise<IUser | null> {
    const user = await UserModel.findOne({ id }).lean().exec();
    return user as IUser | null;
  }

  public static async findByUsername(username: string): Promise<IUser | null> {
    const user = await UserModel.findOne({ username: username.toLowerCase() }).lean().exec();
    return user as IUser | null;
  }

  public static async findByUsernameWithPassword(username: string): Promise<IUser | null> {
    const user = await UserModel.findOne({ username: username.toLowerCase() }).select('+passwordHash').lean().exec();
    return user as IUser | null;
  }

  public static async getAllOfficers(): Promise<IUser[]> {
    const officers = await UserModel.find({ role: 'officer' }).lean().exec();
    return officers as IUser[];
  }

  /** Return all users (for admin management panel) */
  public static async getAllUsers(): Promise<IUser[]> {
    const users = await UserModel.find({}).sort({ createdAt: -1 }).lean().exec();
    return users as IUser[];
  }

  /** Update a user's status by their numeric legacy id */
  public static async updateStatus(
    id: number,
    status: 'APPROVED' | 'REJECTED'
  ): Promise<IUser | null> {
    const user = await UserModel.findOneAndUpdate(
      { id },
      { status },
      { new: true }
    ).lean().exec();
    return user as IUser | null;
  }

  public static async create(
    username: string,
    passwordPlain: string,
    role: 'superadmin' | 'admin' | 'user' | 'operator' | 'supervisor' | 'officer',
    status: 'PENDING' | 'APPROVED' = 'PENDING',
    extraFields?: { name?: string; email?: string; workspaceId?: number }
  ): Promise<IUser | null> {
    try {
      const lowercaseUsername = username.toLowerCase();
      const exists = await UserModel.findOne({ username: lowercaseUsername }).lean().exec();
      if (exists) return null;

      const lastUser = await UserModel.findOne().sort({ id: -1 }).exec();
      const nextId = lastUser ? lastUser.id + 1 : 1;

      // Hash password using bcrypt (10 rounds is standard)
      const passwordHash = await bcrypt.hash(passwordPlain, 10);

      const newUser = await UserModel.create({
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
      return result as IUser;
    } catch (err) {
      console.error('[DATABASE ERROR] createUser failed:', err);
      throw err;
    }
  }

  /**
   * Seed the default superadmin account if it doesn't exist.
   * admin_eyeco = superadmin (satu-satunya superadmin di sistem)
   */
  public static async seedDefaultAdmin(): Promise<void> {
    const superadminUsername = 'admin_eyeco';
    const superadminPassword = process.env.SUPERADMIN_PASSWORD || 'admin123';

    const existing = await UserModel.findOne({ username: superadminUsername }).lean().exec();
    if (!existing) {
      await UserRepository.create(superadminUsername, superadminPassword, 'superadmin', 'APPROVED');
      console.log(`[DATABASE] Superadmin "${superadminUsername}" seeded successfully.`);
    } else if ((existing as IUser).role !== 'superadmin') {
      // Jika sudah ada tapi role salah (misal admin), perbaiki ke superadmin
      const passwordHash = await bcrypt.hash(superadminPassword, 10);
      await UserModel.updateOne(
        { username: superadminUsername },
        { role: 'superadmin', status: 'APPROVED', passwordHash }
      );
      console.log(`[DATABASE] Superadmin "${superadminUsername}" role corrected to superadmin.`);
    } else if ((existing as IUser).status !== 'APPROVED') {
      await UserModel.updateOne({ username: superadminUsername }, { status: 'APPROVED' });
      console.log(`[DATABASE] Superadmin "${superadminUsername}" status restored to APPROVED.`);
    }
  }
}
