import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, type Dirent } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { adapterFor } from '../adapters/index.js';
import { resolveTestScript, scopedTestCommand } from '../adapters/js/index.js';
import { DEFAULT_IGNORED_DIRS, discoverTestFiles } from '../core/engine.js';
import type { LanguageAdapter, Mutant } from '../core/types.js';

export type MutantStatus = 'killed' | 'survived' | 'timeout';

export interface MutantResult extends Mutant {
  status: MutantStatus;
  /** Original source line, trimmed. */
  sourceLine: string;
  durationMs: number;
}

export interface MutateOptions {
  /** Source file to mutate. */
  target: string;
  cwd?: string;
  /** Project root (dir with package.json). Defaults to nearest ancestor of target. */
  root?: string;
  /** Test command. `{files}` is replaced with the related test files. Defaults to the package's `test` script. */
  testCmd?: string;
  /** Stop after this many mutants (default 100). */
  maxMutants?: number;
  /** Per-run timeout; default derived from the baseline run. */
  timeoutMs?: number;
  onProgress?: (done: number, total: number, result: MutantResult) => void;
}

export interface MutationReport {
  target: string;
  root: string;
  command: string;
  relatedTests: string[];
  baselineMs: number;
  generated: number;
  tested: number;
  killed: number;
  survived: number;
  timedOut: number;
  /** 0-100, (killed + timeout) / tested. */
  score: number;
  mutants: MutantResult[];
}

export class MutationError extends Error {
  constructor(
    message: string,
    public output = '',
  ) {
    super(message);
  }
}

function findUp(start: string, name: string): string | null {
  let dir = start;
  for (;;) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Nearest node_modules that holds installed packages (not just a `.vite` cache dir). */
function findNodeModules(start: string): string | null {
  let dir = start;
  for (;;) {
    const candidate = join(dir, 'node_modules');
    if (existsSync(candidate)) {
      const entries = readdirSync(candidate).filter((e) => e !== '.vite' && e !== '.cache' && e !== '.vite-temp');
      if (entries.length > 0) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Every `node_modules/.bin` from `start` upward, so `vitest`/`jest` resolve like they do under npm. */
function binPaths(start: string): string[] {
  const out: string[] = [];
  let dir = start;
  for (;;) {
    const bin = join(dir, 'node_modules', '.bin');
    if (existsSync(bin)) out.push(bin);
    const parent = dirname(dir);
    if (parent === dir) return out;
    dir = parent;
  }
}

function sourceFiles(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!DEFAULT_IGNORED_DIRS.has(e.name)) sourceFiles(p, exts, out);
    } else if (e.isFile() && exts.includes(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

/**
 * Test files that import `target` directly or through other local modules
 * (`test -> Page.jsx -> lib/format.js`). Direct-import-only selection misses
 * tests that exercise the target through its callers, which shows up as
 * false survivors.
 */
export function findRelatedTests(root: string, target: string, adapter: LanguageAdapter): string[] {
  if (!adapter.localImports || !adapter.moduleId) {
    return discoverTestFiles([root], root).filter((f) => adapter.testImportsTarget?.(f, readFileSync(f, 'utf8'), target));
  }
  const importers = new Map<string, string[]>();
  for (const file of sourceFiles(root, adapter.extensions)) {
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const id of new Set(adapter.localImports(file, src))) importers.set(id, [...(importers.get(id) ?? []), file]);
  }
  const tests = new Set<string>();
  const seen = new Set<string>([adapter.moduleId(target)]);
  const queue = [...seen];
  while (queue.length) {
    for (const file of importers.get(queue.shift()!) ?? []) {
      if (adapter.isTestFile(toPosix(file))) {
        tests.add(file);
        continue;
      }
      const id = adapter.moduleId(file);
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
    }
  }
  return [...tests].sort();
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function cleanEnv(extraPath: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    // Don't leak an outer vitest/jest worker context into the child run.
    if (/^(VITEST|JEST_WORKER_ID|TINYPOOL|__VITEST)/.test(k)) continue;
    env[k] = v;
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [...extraPath, env[pathKey] ?? ''].join(delimiter);
  env.FORCE_COLOR = '0';
  env.NO_COLOR = '1';
  return env;
}

interface RunOutcome {
  code: number | null;
  timedOut: boolean;
  output: string;
  durationMs: number;
}

function runCommand(command: string, cwd: string, timeoutMs: number, extraPath: string[]): Promise<RunOutcome> {
  return new Promise((resolvePromise) => {
    const started = Date.now();
    const child = spawn(command, {
      cwd,
      shell: true,
      env: cleanEnv(extraPath),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const collect = (d: Buffer) => {
      output += d.toString();
      if (output.length > 20_000) output = output.slice(-20_000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    let timedOut = false;
    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ code, timedOut, output, durationMs: Date.now() - started });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ code: 1, timedOut, output: output + String(err), durationMs: Date.now() - started });
    });
  });
}

function shellQuote(s: string): string {
  return /^[\w./@:-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Mutation-test one source file.
 *
 * Safety: the project is copied to a fresh temp directory (node_modules is
 * symlinked, never copied or written by us). Mutants are written only inside
 * the copy, restored after every run, and the copy is deleted at the end —
 * including on Ctrl-C. Your working tree is never modified.
 */
export async function mutate(opts: MutateOptions): Promise<MutationReport> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const target = resolve(cwd, opts.target);
  if (!existsSync(target)) throw new MutationError(`Target file not found: ${opts.target}`);
  const adapter = adapterFor(target);
  if (!adapter?.generateMutants) throw new MutationError(`Mutation is not supported for ${opts.target} yet.`);

  const pkg = opts.root ? join(resolve(cwd, opts.root), 'package.json') : findUp(dirname(target), 'package.json');
  if (!pkg || !existsSync(pkg)) throw new MutationError(`Could not find a package.json above ${opts.target}; pass --root.`);
  const root = dirname(pkg);
  const relTarget = relative(root, target);
  if (relTarget.startsWith('..')) throw new MutationError(`Target ${opts.target} is outside project root ${root}.`);

  // Which tests exercise this file?
  const relatedTests = findRelatedTests(root, target, adapter).map((f) => toPosix(relative(root, f)));

  let command = opts.testCmd ?? null;
  if (command) {
    command = command.replace('{files}', relatedTests.map(shellQuote).join(' '));
  } else {
    command = adapter.defaultTestCommand?.(root) ?? null;
    if (!command) throw new MutationError('Could not determine how to run tests (no "test" script in package.json). Pass --test-cmd "<command>".');
    command = scopedTestCommand(resolveTestScript(root), relatedTests.map(shellQuote)) ?? command;
  }

  const source = readFileSync(target, 'utf8');
  const all = adapter.generateMutants(target, source);
  const mutants = all.slice(0, opts.maxMutants ?? 100);
  const sourceLines = source.split(/\r?\n/);

  const tmp = mkdtempSync(join(tmpdir(), 'honest-tests-'));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  const onSignal = (sig: NodeJS.Signals) => {
    cleanup();
    process.kill(process.pid, sig);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    cpSync(root, tmp, {
      recursive: true,
      filter: (src) => {
        const rel = relative(root, src);
        const first = rel.split(sep)[0];
        return !rel.split(sep).includes('node_modules') && first !== '.git';
      },
    });
    const nm = findNodeModules(root);
    if (nm) symlinkSync(nm, join(tmp, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');

    const tmpTarget = join(tmp, relTarget);
    const extraPath = [join(tmp, 'node_modules', '.bin'), ...binPaths(root)];

    const baseline = await runCommand(command, tmp, opts.timeoutMs ?? 5 * 60_000, extraPath);
    if (baseline.code !== 0) {
      throw new MutationError(
        baseline.timedOut
          ? `Test command timed out before any mutation (${command}). If it starts a watcher or needs services, pass --test-cmd "<command that runs once>".`
          : `Tests fail before any mutation (exit ${baseline.code}). Fix them first — mutation results would be meaningless.`,
        baseline.output,
      );
    }
    const timeoutMs = opts.timeoutMs ?? Math.max(10_000, baseline.durationMs * 4 + 5_000);

    const results: MutantResult[] = [];
    for (const m of mutants) {
      let outcome: RunOutcome;
      try {
        writeFileSync(tmpTarget, source.slice(0, m.start) + m.replacement + source.slice(m.end));
        outcome = await runCommand(command, tmp, timeoutMs, extraPath);
      } finally {
        writeFileSync(tmpTarget, source);
      }
      const status: MutantStatus = outcome.timedOut ? 'timeout' : outcome.code === 0 ? 'survived' : 'killed';
      const r: MutantResult = { ...m, file: toPosix(relative(cwd, target)), status, sourceLine: (sourceLines[m.line - 1] ?? '').trim(), durationMs: outcome.durationMs };
      results.push(r);
      opts.onProgress?.(results.length, mutants.length, r);
    }

    const killed = results.filter((r) => r.status === 'killed').length;
    const timedOut = results.filter((r) => r.status === 'timeout').length;
    const survived = results.filter((r) => r.status === 'survived').length;
    return {
      target: toPosix(relative(cwd, target)),
      root: toPosix(relative(cwd, root)) || '.',
      command,
      relatedTests,
      baselineMs: baseline.durationMs,
      generated: all.length,
      tested: results.length,
      killed,
      survived,
      timedOut,
      score: results.length ? Math.round(((killed + timedOut) / results.length) * 1000) / 10 : 100,
      mutants: results,
    };
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    cleanup();
  }
}
