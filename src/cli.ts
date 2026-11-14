#!/usr/bin/env node
import { run } from './run.js';

// `honest-tests audit | head` closes the pipe early; that's not an error worth a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(process.exitCode ?? 0);
    throw err;
  });
}

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
