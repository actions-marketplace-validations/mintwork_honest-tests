#!/usr/bin/env node
import { run } from './run.js';

run(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
  progress: process.stderr.isTTY,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`honest-tests: ${(err as Error)?.stack ?? String(err)}\n`);
    process.exitCode = 2;
  },
);
