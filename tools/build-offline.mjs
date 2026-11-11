// Build dist/map-compressor-offline.html: ONE self-contained file with every
// library and style inlined, so it runs from a laptop, USB stick or shared
// drive with no internet, no install and no server.
//
//   npm install --ignore-scripts
//   npm run build:offline

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const result = await build({
    entryPoints: [path.join(root, 'web/app.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    write: false,
    metafile: true,
    legalComments: 'none',  // licences are collected in full below instead
    logLevel: 'warning',
});
const js = result.outputFiles[0].text;
const css = fs.readFileSync(path.join(root, 'node_modules/maplibre-gl/dist/maplibre-gl.css'), 'utf8');

// Collect the licence of every third-party package that ended up in the bundle.
const used = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
    const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
    if (m) used.add(m[1]);
}
const notices = [...used].sort().map((name) => {
    const dir = path.join(root, 'node_modules', name);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : `License: ${meta.license || 'see package'}`;
    return `${'='.repeat(72)}\n${name} ${meta.version} (${meta.license || 'unknown'})\n${'='.repeat(72)}\n${text}\n`;
}).join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/THIRD-PARTY-LICENSES.txt'),
    `Map Compressor ${pkg.version} bundles the following open-source packages.\n\n${notices}`);

const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
let html = fs.readFileSync(path.join(root, 'web/template.html'), 'utf8');
html = html
    .replace('<!-- INLINE_CSS -->', () => `<style>${safe(css)}</style>`)
    .replace('<!-- INLINE_JS -->', () => `<script>\n/* Map Compressor ${pkg.version}. Third-party licences: THIRD-PARTY-LICENSES.txt\n${safe(notices).replace(/\*\//g, '* /')}\n*/\n${safe(js)}</script>`);
const out = path.join(root, 'dist/map-compressor-offline.html');
fs.writeFileSync(out, html);
console.log(`Wrote ${path.relative(root, out)} (${(fs.statSync(out).size / 1e6).toFixed(2)} MB, ${used.size} bundled packages)`);
