Pod::Spec.new do |s|
  s.name           = 'SystemAppearance'
  s.version        = '1.0.0'
  s.summary        = "Reads the phone's own light or dark setting"
  s.description    = "Reads the window scene's interface style, which the app's dark window override does not change"
  s.author         = ''
  s.homepage       = 'https://github.com/JesusFilm/forge'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.swift"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
