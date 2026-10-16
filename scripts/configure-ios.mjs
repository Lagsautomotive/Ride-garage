import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'ios/App/App');
const plist=resolve(target,'Info.plist');
if(!existsSync(plist))throw new Error('Generate iOS first with npm run ios:init.');
const purpose={
 en:'Ride Garage records your route, speed and distance only after you tap Start ride. During a recording, location continues when the screen is locked. Pause or Stop ends location updates.',
 es:'Ride Garage registra tu ruta, velocidad y distancia solo después de que seleccionas Iniciar rodada. Durante la grabación, la ubicación continúa con la pantalla bloqueada. Pausar o Detener desactiva las actualizaciones de ubicación.'
};
const python="\nimport plistlib\nimport sys\nfrom pathlib import Path\npath = Path(sys.argv[1])\nwith path.open('rb') as handle:\n    info = plistlib.load(handle)\ninfo['NSLocationWhenInUseUsageDescription'] = sys.argv[2]\ninfo['CFBundleLocalizations'] = list(dict.fromkeys(info.get('CFBundleLocalizations', []) + ['en', 'es']))\nmodes = info.get('UIBackgroundModes', [])\nif 'location' not in modes:\n    modes.append('location')\ninfo['UIBackgroundModes'] = modes\nwith path.open('wb') as handle:\n    plistlib.dump(info, handle, fmt=plistlib.FMT_XML, sort_keys=False)\n";
function run(command,args,failure){
 const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error(failure);
}
run('python3',['-c',python,plist,purpose.en],'Could not configure iOS location permission.');
for(const [language,message] of Object.entries(purpose)){
 const directory=resolve(target,language+'.lproj');
 mkdirSync(directory,{recursive:true});
 writeFileSync(resolve(directory,'InfoPlist.strings'),
  '/* Location purpose; iOS selects this using its app/system language. */\n'+
  '"NSLocationWhenInUseUsageDescription" = '+JSON.stringify(message)+';\n');
}
// xcodeproj is installed with CocoaPods; use the same Ruby environment.
const ruby="\nrequire 'xcodeproj'\nproject = Xcodeproj::Project.open(ARGV.fetch(0))\napp = project.targets.find { |item| item.product_type == 'com.apple.product-type.application' }\nraise 'No iOS application target found.' unless app\ngroup = project.main_group.groups.find { |item| item.path == 'App' || item.name == 'App' }\nraise 'No generated App resource group found.' unless group\nvariant = group.children.find do |item|\n  item.isa == 'PBXVariantGroup' && (item.name == 'InfoPlist.strings' || item.path == 'InfoPlist.strings')\nend\nunless variant\n  variant = project.new(Xcodeproj::Project::Object::PBXVariantGroup)\n  variant.name = 'InfoPlist.strings'\n  variant.source_tree = '<group>'\n  group.children << variant\nend\n%w[en es].each do |language|\n  file = variant.children.find { |item| item.name == language }\n  file ||= variant.new_file(\"#{language}.lproj/InfoPlist.strings\")\n  file.name = language\n  file.path = \"#{language}.lproj/InfoPlist.strings\"\n  file.last_known_file_type = 'text.plist.strings'\nend\nunless app.resources_build_phase.files_references.include?(variant)\n  app.resources_build_phase.add_file_reference(variant, true)\nend\nproject.root_object.known_regions |= %w[en es]\nproject.root_object.development_region = 'en'\nproject.save\n";
run('ruby',['-e',ruby,resolve(root,'ios/App/App.xcodeproj')],
 'Could not bundle localized location permissions. Use the Ruby environment where CocoaPods and its xcodeproj gem are installed.');
const generated=JSON.parse(readFileSync(resolve(target,'capacitor.config.json'),'utf8'));
if(!generated.packageClassList?.includes('RideRecorderPlugin'))throw new Error('RideRecorderPlugin was not discovered by Capacitor. Check the local npm dependency and run npm run ios:sync.');
const podfile=readFileSync(resolve(root,'ios/App/Podfile'),'utf8');
if(!/pod ['"]RideGarageRideRecorder['"]/.test(podfile))throw new Error('RideRecorder CocoaPod was not linked.');
console.log('Configured background location, bundled English/Spanish permission text, and verified native RideRecorder registration.');
