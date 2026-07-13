"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiResponse = void 0;
class ApiResponse {
    static success(res, message, data, requestId, status = 200) {
        return res.status(status).json({
            success: true,
            message,
            timestamp: new Date().toISOString(),
            requestId: requestId || res.req?.requestId || '',
            data: data || null
        });
    }
    static error(res, message, code, requestId, status = 400) {
        return res.status(status).json({
            success: false,
            message,
            timestamp: new Date().toISOString(),
            requestId: requestId || res.req?.requestId || '',
            code
        });
    }
}
exports.ApiResponse = ApiResponse;
