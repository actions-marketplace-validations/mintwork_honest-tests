import { join, resolve } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { jsAdapter, resolveTestScript, scopedTestCommand } from '../src/adapters/js/index.js';
import { applyMutant, generateJsMutants } from '../src/adapters/js/mutants.js';
import { mutate } from '../src/mutate/runner.js';

const ROOT = resolve(__dirname, '..');

describe('generateJsMutants', () => {
  const describeAll = (src: string) => generateJsMutants('x.ts', src).map((m) => `${m.line}:${m.column} ${m.original} -> ${m.replacement}`);

  it('flips comparison, arithmetic and logical operators', () => {
    expect(describeAll(`const ok = a >= b && c + d;`)).toEqual(['1:14 >= -> >', '1:19 && -> ||', '1:24 + -> -']);
  });

  it('flips booleans, removes negation, tweaks numbers and replaces return values', () => {
    expect(describeAll(`function f(x) {\n  if (!x) return false;\n  return 41;\n}`)).toEqual([
      '2:7 !x -> true',
      '2:7 !x -> false',
      '2:7 !x -> (x)',
      '2:18 false -> true',
      '3:10 41 -> undefined',
      '3:10 41 -> 42',
    ]);
  });

  it('never touches types, imports, string concatenation or logging', () => {
    const src = [
      `import { a } from './a';`,
      `type N = 1 | 2;`,
      `function g(n: Array<1>): string {`,
      `  console.log(n.length > 0);`,
      `  return 'a' + n;`,
      `}`,
    ].join('\n');
    expect(describeAll(src)).toEqual(["5:10 'a' + n -> undefined"]);
  });

  it('applies a mutant by splicing only its range', () => {
    const src = 'return a < b;';
    const [m] = generateJsMutants('x.ts', src).filter((x) => x.operator === 'binary');
    expect(applyMutant(src, m!)).toBe('return a <= b;');
  });
});

describe('mutate() on fixture projects', { timeout: 180_000 }, () => {
  it('weak tests let most mutants survive', async () => {
    const target = 'fixtures/bad-project/src/pricing.ts';
    const before = readFileSync(resolve(ROOT, target), 'utf8');
    const report = await mutate({ target, cwd: ROOT });
    expect(report.relatedTests).toEqual(['test/pricing.test.ts']);
    expect(report.command).toBe('npm test --silent -- test/pricing.test.ts');
    expect(report.tested).toBe(26);
    expect(report.survived).toBe(22);
    expect(report.score).toBeLessThan(20);
    const survivedLines = new Set(report.mutants.filter((m) => m.status === 'survived').map((m) => m.line));
    expect(survivedLines).toEqual(new Set([7, 9, 15, 18, 22, 26, 27, 29]));
    // the working tree is never modified
    expect(readFileSync(resolve(ROOT, target), 'utf8')).toBe(before);
  });

  it('honest tests kill every mutant', async () => {
    const report = await mutate({ target: 'fixtures/good-project/src/pricing.ts', cwd: ROOT });
    expect(report.mutants.filter((m) => m.status === 'survived')).toEqual([]);
    expect(report.score).toBe(100);
  });

  it('refuses to run when the tests already fail', async () => {
    await expect(
      mutate({ target: 'fixtures/good-project/src/pricing.ts', cwd: ROOT, testCmd: 'node -e "process.exit(3)"', maxMutants: 1 }),
    ).rejects.toThrow('Tests fail before any mutation');
  });

  it('respects --test-cmd with {files} and --max-mutants', async () => {
    const report = await mutate({
      target: 'fixtures/good-project/src/pricing.ts',
      cwd: ROOT,
      testCmd: 'vitest run {files}',
      maxMutants: 3,
    });
    expect(report.command).toBe('vitest run test/pricing.test.ts');
    expect(report.tested).toBe(3);
    expect(report.generated).toBe(26);
    expect(report.killed).toBe(3);
  });

  it('rejects unsupported targets', async () => {
    const target = 'fixtures/python-project/tests/test_pricing.py';
    expect(existsSync(resolve(ROOT, target))).toBe(true);
    await expect(mutate({ target, cwd: ROOT })).rejects.toThrow('not supported');
  });
});

describe('test command for mutation runs (field-test regressions)', () => {
  const withScripts = (scripts: Record<string, string>, files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'ht-scripts-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
      return scopedTestCommand(resolveTestScript(dir), files);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('adds --run to a bare `vitest` script so the baseline does not hang in watch mode', () => {
    expect(withScripts({ test: 'vitest' }, ['a.test.ts'])).toBe('npm test --silent -- --run a.test.ts');
    expect(withScripts({ test: 'vitest run --coverage' }, ['a.test.ts'])).toBe('npm test --silent -- a.test.ts');
  });

  it('follows `npm run x` delegation and runs the leaf script directly', () => {
    expect(withScripts({ test: 'npm run test:vitest', 'test:vitest': 'vitest run' }, ['t/a.test.js'])).toBe('vitest run t/a.test.js');
    expect(withScripts({ test: 'pnpm test:unit', 'test:unit': 'jest --ci' }, [])).toBe('jest --ci');
  });

  it('does not extend chained or unknown scripts', () => {
    expect(withScripts({ test: 'npm run t', t: 'tsc && vitest run' }, ['a.test.ts'])).toBeNull();
    expect(withScripts({ test: 'ava' }, ['a.test.ts'])).toBeNull();
  });
});

describe('test file discovery (field-test regressions)', () => {
  it('recognizes co-located test.ts / spec.js files', () => {
    expect(jsAdapter.isTestFile('/repo/src/addDays/test.ts')).toBe(true);
    expect(jsAdapter.isTestFile('/repo/src/parse/spec.mjs')).toBe(true);
    expect(jsAdapter.isTestFile('/repo/src/latest.ts')).toBe(false);
    expect(jsAdapter.isTestFile('/repo/src/contest.ts')).toBe(false);
  });
});
