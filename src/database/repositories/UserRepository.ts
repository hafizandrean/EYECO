import { UserModel, IUser } from '../models/User';
import mongoose from 'mongoose';

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

  public static async getAllOfficers(): Promise<IUser[]> {
    const officers = await UserModel.find({ role: 'officer' }).lean().exec();
    return officers as IUser[];
  }
}
