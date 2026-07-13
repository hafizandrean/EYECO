import { Response } from 'express';

export class ApiResponse {
  public static success(res: Response, message: string, data?: any, requestId?: string, status: number = 200) {
    return res.status(status).json({
      success: true,
      message,
      timestamp: new Date().toISOString(),
      requestId: requestId || (res.req as any)?.requestId || '',
      data: data || null
    });
  }

  public static error(res: Response, message: string, code: string, requestId?: string, status: number = 400) {
    return res.status(status).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
      requestId: requestId || (res.req as any)?.requestId || '',
      code
    });
  }
}
