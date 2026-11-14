import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LanguageAdapter } from '../../core/types.js';
import { generateJsMutants } from './mutants.js';
import { parseJsTestFile } from './parse-tests.js';

const EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
const TEST_FILE = /(\.|_|-)(test|spec)\.(m|c)?[jt]sx?$/i;

function stripExt(p: string): string {
  return p.replace(/\.(m|c)?[jt]sx?$/, '').replace(/\/index$/, '');
}

export const jsAdapter: LanguageAdapter = {
  id: 'js',
  extensions: EXT,
  isTestFile(path) {
    const p = path.replace(/\\/g, '/');
    return TEST_FILE.test(p) || (/\/__tests__\//.test(p) && /\.(m|c)?[jt]sx?$/.test(p));
  },
  parseTestFile: parseJsTestFile,
  generateMutants: generateJsMutants,
  testImportsTarget(testPath, testSource, targetPath) {
    const target = stripExt(resolve(targetPath));
    const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|mock\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
    for (const m of testSource.matchAll(re)) {
      const spec = m[1]!;
      if (!spec.startsWith('.')) continue;
      if (stripExt(resolve(dirname(testPath), spec)) === target) return true;
    }
    return false;
  },
  defaultTestCommand(root) {
    const pkgPath = join(root, 'package.json');
    if (!existsSync(pkgPath)) return null;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
      const script = pkg.scripts?.test;
      if (!script || /no test specified/.test(script)) return null;
      return 'npm test --silent';
    } catch {
      return null;
    }
  },
};

/** Which runner a package.json test script uses — lets us pass test files through. */
export function detectRunner(root: string): 'vitest' | 'jest' | 'unknown' {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const script = pkg.scripts?.test ?? '';
    if (/\bvitest\b/.test(script)) return 'vitest';
    if (/\bjest\b/.test(script)) return 'jest';
  } catch {
    /* ignore */
  }
  return 'unknown';
}
