import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LanguageAdapter } from '../../core/types.js';
import { generateJsMutants } from './mutants.js';
import { parseJsTestFile } from './parse-tests.js';

const EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'];
const TEST_FILE = /(\.|_|-)(test|spec)\.(m|c)?[jt]sx?$/i;
/** Co-located `foo/test.ts` / `foo/spec.js` (date-fns style). */
const BARE_TEST_FILE = /(^|\/)(test|spec)\.(m|c)?[jt]sx?$/i;

function stripExt(p: string): string {
  return p.replace(/\.(m|c)?[jt]sx?$/, '').replace(/\/index$/, '');
}

export const jsAdapter: LanguageAdapter = {
  id: 'js',
  extensions: EXT,
  isTestFile(path) {
    const p = path.replace(/\\/g, '/');
    return TEST_FILE.test(p) || BARE_TEST_FILE.test(p) || (/\/__tests__\//.test(p) && /\.(m|c)?[jt]sx?$/.test(p));
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

export interface TestScript {
  runner: 'vitest' | 'jest' | 'unknown';
  /** The script that actually runs tests, after following `npm run x` / `pnpm x` delegation. */
  script: string;
  /** The script is one plain command (no `&&`, `;`, pipes) we can run directly with extra arguments. */
  simple: boolean;
  /** `test` only delegates to another script (`npm run test:unit`). */
  delegated: boolean;
}

/** Follow `"test": "npm run test:unit"` chains to the script that runs the test runner. */
export function resolveTestScript(root: string): TestScript {
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
  } catch {
    /* ignore */
  }
  let script = scripts.test ?? '';
  let delegated = false;
  for (let hops = 0; hops < 5; hops++) {
    const m = /^\s*(?:npm run|npm run-script|pnpm(?: run)?|yarn(?: run)?|bun run)\s+([\w:.-]+)\s*$/.exec(script);
    if (!m || scripts[m[1]!] === undefined) break;
    script = scripts[m[1]!]!;
    delegated = true;
  }
  const runner = /\bvitest\b/.test(script) ? 'vitest' : /\bjest\b/.test(script) ? 'jest' : 'unknown';
  return { runner, script: script.trim(), simple: !/&&|\|\||;|\||`|\$\(/.test(script), delegated };
}

/** Which runner a package.json test script uses — lets us pass test files through. */
export function detectRunner(root: string): 'vitest' | 'jest' | 'unknown' {
  return resolveTestScript(root).runner;
}

/**
 * How to run `files` (already shell-quoted) once, never in watch mode:
 * - `test` runs vitest/jest itself: `npm test --silent -- [--run] <files>` (keeps npm pre/post hooks).
 * - `test` delegates (`npm run test:vitest`): run the plain leaf script directly, since npm would
 *   swallow `--run` as one of its own flags.
 * Returns null when we can't safely add arguments (unknown runner, `a && b` chains).
 */
export function scopedTestCommand(ts: TestScript, files: string[]): string | null {
  if (ts.runner === 'unknown') return null;
  // A bare `vitest` script starts a watcher; mutation runs must exit.
  const needsRun = ts.runner === 'vitest' && !/\bvitest\s+(run|bench)\b|--run\b|--watch=false|--no-watch\b/.test(ts.script);
  const extra = [...(needsRun ? ['--run'] : []), ...files];
  if (!ts.delegated) return extra.length ? `npm test --silent -- ${extra.join(' ')}` : 'npm test --silent';
  if (!ts.simple) return null;
  return [ts.script, ...extra].join(' ');
}
