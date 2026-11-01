// Copies the SQL migration files next to the compiled main process (tsc does not copy .sql files).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist-electron', 'db'), { recursive: true });
cpSync(join(root, 'electron', 'db', 'migrations'), join(root, 'dist-electron', 'db', 'migrations'), { recursive: true });
console.log('Copied SQL migrations to dist-electron/db/migrations');
