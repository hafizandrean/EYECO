import path from 'path';

export interface IMlExecutionContext {
  environment: 'TEST' | 'STAGING' | 'PRODUCTION';
  testRunId?: string;
  artifactRoot: string;
  databaseName: string;
}

export function toRelativePosixPath(filePath: string, rootDir: string = process.cwd()): string {
  if (!filePath) return '';
  let relPath = filePath;
  if (path.isAbsolute(filePath)) {
    relPath = path.relative(rootDir, filePath);
  }
  return relPath.replace(/\\/g, '/');
}
