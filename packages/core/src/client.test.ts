import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SERVER_ONLY = /^(node:|openai$|sharp$|jsqr$)/;
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;]*?\sfrom\s+)?'([^']+)'/g;

/** Runtime (non-type) imports reachable from a file: relative files and package names. */
function reachableImports(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (!file.endsWith('.ts')) return;
    for (const [, typeOnly, spec] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      if (typeOnly || !spec) continue;
      if (!spec.startsWith('.')) {
        packages.add(spec);
        continue;
      }
      const base = resolve(dirname(file), spec);
      const target = [`${base}.ts`, join(base, 'index.ts'), base].find(
        (f) => existsSync(f) && statSync(f).isFile(),
      );
      if (!target) throw new Error(`cannot resolve ${spec} from ${file}`);
      visit(target);
    }
  };
  visit(entry);
  return { files, packages };
}

const serverOnly = (entry: string) =>
  [...reachableImports(fileURLToPath(new URL(entry, import.meta.url))).packages].filter((p) =>
    SERVER_ONLY.test(p),
  );

describe('@chatbot/core/client', () => {
  it('reaches no Node, openai, sharp or jsqr code, so the browser can import it', () => {
    expect(serverOnly('./client.ts')).toEqual([]);
  });

  it('detects server-only code (the server entry does reach it)', () => {
    expect(serverOnly('./index.ts')).toEqual(expect.arrayContaining(['openai', 'node:fs']));
  });
});
