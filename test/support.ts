import { auditSource } from '../src/core/engine.js';
import type { Finding } from '../src/core/types.js';

export const HEADER = "import { describe, expect, it, test, vi } from 'vitest';\n";

/** Audit an inline test file. Line numbers in results include the 1-line HEADER. */
export function scan(body: string, file = 'src/widget.test.ts'): Finding[] {
  return auditSource(file, HEADER + body);
}

/** `rule@line` pairs — compact and order-stable for assertions. */
export function hits(body: string, file?: string): string[] {
  return scan(body, file).map((f) => `${f.ruleId}@${f.line}`);
}
