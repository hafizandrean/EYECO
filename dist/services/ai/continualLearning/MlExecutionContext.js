"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRelativePosixPath = toRelativePosixPath;
const path_1 = __importDefault(require("path"));
function toRelativePosixPath(filePath, rootDir = process.cwd()) {
    if (!filePath)
        return '';
    let relPath = filePath;
    if (path_1.default.isAbsolute(filePath)) {
        relPath = path_1.default.relative(rootDir, filePath);
    }
    return relPath.replace(/\\/g, '/');
}
