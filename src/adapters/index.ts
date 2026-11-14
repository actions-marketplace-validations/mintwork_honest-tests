import { extname } from 'node:path';
import type { LanguageAdapter } from '../core/types.js';
import { jsAdapter } from './js/index.js';
import { pythonAdapter } from './python/index.js';

export const adapters: LanguageAdapter[] = [jsAdapter, pythonAdapter];

export function adapterFor(path: string): LanguageAdapter | undefined {
  const ext = extname(path).toLowerCase();
  return adapters.find((a) => a.extensions.includes(ext));
}
