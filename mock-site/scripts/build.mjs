import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'public');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(root, 'assets'), path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.min.js'), path.join(output, 'assets', 'chart-3.9.1.min.js'));
await cp(path.join(root, 'node_modules', 'chartjs-plugin-datalabels', 'dist', 'chartjs-plugin-datalabels.min.js'), path.join(output, 'assets', 'chartjs-plugin-datalabels-2.2.0.min.js'));

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name.endsWith('.html') || entry.name === 'favicon.ico')) {
    await cp(path.join(root, entry.name), path.join(output, entry.name));
  }
}

// `/tv` is a stable, uncached and navigation-free entry point for wall displays.
// Keeping a separate URL also bypasses HTML older TVs may have cached at `/`.
const dashboardHtml = await readFile(path.join(output, 'index.html'), 'utf8');
await writeFile(
  path.join(output, 'tv.html'),
  dashboardHtml.replace('<body>', '<body class="tv-display">'),
  'utf8'
);
