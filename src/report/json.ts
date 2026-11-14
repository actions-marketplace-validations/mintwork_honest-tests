import type { AuditResult } from '../core/engine.js';
import type { MutationReport } from '../mutate/runner.js';

export const JSON_SCHEMA_VERSION = 1;

export function toJson(audit: AuditResult | null, mutation: MutationReport | null): string {
  return JSON.stringify(
    {
      schemaVersion: JSON_SCHEMA_VERSION,
      ...(audit ?? {}),
      ...(mutation ? { mutation } : {}),
    },
    null,
    2,
  );
}
