import { IReport } from '../database/models/Report';

export interface INotificationChannel {
  name: string;
  send(report: IReport): Promise<boolean>;
}
