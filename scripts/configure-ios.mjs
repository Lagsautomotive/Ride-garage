import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'ios/App/App');
const plist = resolve(target, 'Info.plist');
if (!existsSync(plist)) throw new Error('Generate iOS first with npm run ios:init.');
const python = String.raw`
import plistlib
import sys
from pathlib import Path

path = Path(sys.argv[1])
with path.open('rb') as handle:
    info = plistlib.load(handle)
info['NSLocationWhenInUseUsageDescription'] = (
    'Ride Garage records your route, speed and distance only after you tap Start ride. '
    'During a recording, location continues when the screen is locked. '
    'Pause or Stop ends location updates.'
)
modes = info.get('UIBackgroundModes', [])
if 'location' not in modes:
    modes.append('location')
info['UIBackgroundModes'] = modes
with path.open('wb') as handle:
    plistlib.dump(info, handle, fmt=plistlib.FMT_XML, sort_keys=False)
`;
const result = spawnSync('python3', ['-c', python, plist], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Could not configure iOS location permission.');
const generated = JSON.parse(readFileSync(resolve(target, 'capacitor.config.json'), 'utf8'));
if (!generated.packageClassList?.includes('RideRecorderPlugin')) {
  throw new Error('RideRecorderPlugin was not discovered by Capacitor. Check the local npm dependency and run npm run ios:sync.');
}
const podfile = readFileSync(resolve(root, 'ios/App/Podfile'), 'utf8');
if (!/pod ['"]RideRecorder['"]/.test(podfile)) throw new Error('RideRecorder CocoaPod was not linked.');
console.log('Configured location background mode and verified native RideRecorder registration.');
