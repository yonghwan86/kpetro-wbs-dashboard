import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'public');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith('.html') || entry.name === 'favicon.ico')) {
    await cp(path.join(root, entry.name), path.join(output, entry.name));
  }
}

// `/tv` is a stable, uncached entry point for wall displays. Keeping a separate
// URL also bypasses HTML that older smart-TV browsers may have cached at `/`.
await cp(path.join(output, 'index.html'), path.join(output, 'tv.html'));
