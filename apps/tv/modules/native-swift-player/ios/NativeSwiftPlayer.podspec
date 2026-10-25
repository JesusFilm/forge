Pod::Spec.new do |s|
  s.name = 'NativeSwiftPlayer'
  s.version = '0.1.0'
  s.summary = 'Experimental native AVKit player for Forge TV'
  s.description = 'An opt-in tvOS AVPlayerViewController bridge.'
  s.license = { :type => 'MIT' }
  s.author = 'Jesus Film Project'
  s.homepage = 'https://www.jesusfilm.org/'
  s.platforms = { :tvos => '15.1' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'AVKit', 'UIKit'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
