require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'RideRecorder'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://github.com/Lagsautomotive/Ride-garage'
  s.author = 'Ride Garage'
  s.source = { :git => 'https://github.com/Lagsautomotive/Ride-garage.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/RideRecorderPlugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor', '~> 8.0'
  s.frameworks = 'CoreLocation', 'UIKit'
  s.swift_version = '5.9'
  s.static_framework = true
  s.module_name = 'RideRecorder'
end
