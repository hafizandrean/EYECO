import mongoose, { Schema } from 'mongoose';

export interface ICounter {
  _id: string;
  seq: number;
}

const CounterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { _id: false });

export const CounterModel = mongoose.models.Counter || mongoose.model<ICounter>('Counter', CounterSchema);

/**
 * Atomic counter sequence generator using findOneAndUpdate with $inc.
 * Prevents race conditions and E11000 duplicate key errors under concurrent executions.
 */
export async function getNextSequence(sequenceName: string, seedModel?: any): Promise<number> {
  let counter = (await CounterModel.findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true, new: true }
  ).exec() as unknown) as ICounter | null;

  if (!counter) return 1;

  // Ensure counter sequence is aligned with max legacy ID in database using $max operator
  if (seedModel) {
    const maxDoc = await seedModel.findOne().sort({ id: -1 }).select({ id: 1 }).lean().exec();
    if (maxDoc && typeof maxDoc.id === 'number' && counter.seq <= maxDoc.id) {
      const seeded = (await CounterModel.findOneAndUpdate(
        { _id: sequenceName },
        { $max: { seq: maxDoc.id + 1 } },
        { returnDocument: 'after', upsert: true, new: true }
      ).exec() as unknown) as ICounter | null;
      return seeded ? seeded.seq : maxDoc.id + 1;
    }
  }

  return counter.seq;
}
