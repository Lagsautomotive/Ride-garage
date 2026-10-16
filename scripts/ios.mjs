import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (!['init', 'sync'].includes(mode)) throw new Error('Usage: node scripts/ios.mjs init|sync');
if (process.platform !== 'darwin') throw new Error('iOS builds require a Mac with Xcode and CocoaPods.');
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(command + ' failed with status ' + result.status);
}
run(process.execPath, ['scripts/build-native.mjs']);
const cli = resolve(root, 'node_modules/@capacitor/cli/bin/capacitor');
if (!existsSync(resolve(root, 'ios/App/App.xcodeproj'))) {
  if (mode !== 'init') throw new Error('No iOS project. Run npm run ios:init once.');
  // Use CocoaPods explicitly: Capacitor 8 otherwise defaults to SPM.
  // The plugin's Swift package is for Foundation journal tests only.
  run(process.execPath, [cli, 'add', 'ios', '--packagemanager', 'CocoaPods']);
}
run(process.execPath, [cli, 'sync', 'ios']);
run(process.execPath, ['scripts/configure-ios.mjs']);
