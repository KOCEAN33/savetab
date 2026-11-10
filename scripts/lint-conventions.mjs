// Repo rules from CLAUDE.md that oxlint cannot express. Run by `pnpm lint`.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const SKIP = new Set(['node_modules', '.output', '.wxt', 'test-results', 'playwright-report', 'dist']);
const errors = [];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else yield file;
  }
}

const rel = (file) => path.relative(root, file);

// Every list write goes through a core mutation inside `transact`, so only lib/db.ts writes tables.
const TABLE_WRITE = /\bdb\.\w+\.(put|add|bulkPut|bulkAdd|bulkDelete|bulkUpdate|delete|update|modify|clear)\s*\(/;
const DB_FILE = path.join(root, 'apps/extension/lib/db.ts');
for (const file of walk(path.join(root, 'apps/extension'))) {
  if (!/\.(ts|svelte)$/.test(file) || file === DB_FILE || file.endsWith('.test.ts')) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (TABLE_WRITE.test(line))
        errors.push(`${rel(file)}:${i + 1} writes a table directly. Use a @savetab/core mutation inside transact.`);
    });
}

// svelte-check 4 rejects TypeScript 7.
for (const file of walk(root)) {
  if (path.basename(file) !== 'package.json') continue;
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const version = { ...pkg.dependencies, ...pkg.devDependencies }.typescript;
  if (version && !/^[\^~]?6\./.test(version))
    errors.push(`${rel(file)} has typescript ${version}. TypeScript stays on 6.x.`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
