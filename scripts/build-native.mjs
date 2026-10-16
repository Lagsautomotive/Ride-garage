import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(resolve(root, 'capacitor.config.json'), 'utf8'));
if (config.webDir !== 'www') throw new Error('Expected generated webDir www.');
const output = resolve(root, 'www');
const runtime = resolve(root, 'node_modules/@capacitor/core/dist/capacitor.js');
if (!existsSync(runtime)) throw new Error('Install dependencies with npm install first.');

// The source PWA stays at the repository root. Copy only its runtime files:
// never package SQL, backups/archives, native sources, dependencies or docs.
const allowed = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.webmanifest']);
const entries = readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isFile() && allowed.has(extname(entry.name)) && entry.name !== 'sw.js')
  .sort((a, b) => a.name.localeCompare(b.name));
for (const required of ['index.html', 'config.js', 'native-ride.js', 'ride-maps.js']) {
  if (!entries.some(entry => entry.name === required)) throw new Error('Missing app asset: ' + required);
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output);
copyFileSync(runtime, resolve(output, 'capacitor-core.js'));
for (const entry of entries) {
  const destination = resolve(output, entry.name);
  if (extname(entry.name) === '.html') {
    const source = readFileSync(resolve(root, entry.name), 'utf8');
    if (!/<head(?:\s[^>]*)?>/i.test(source)) throw new Error('Missing head in ' + entry.name);
    // Capacitor injects its native bridge at document start. Its core runtime
    // adds registerPlugin to that same global before our application scripts run.
    const html = source.replace(/<head(?:\s[^>]*)?>/i, head => head + '\n<script src="capacitor-core.js"></script>');
    writeFileSync(destination, html);
  } else {
    copyFileSync(resolve(root, entry.name), destination);
  }
}
console.log('Packaged ' + entries.length + ' app assets and the Capacitor core runtime into www/.');
