Pod::Spec.new do |s|
  s.name           = 'LayoutDirection'
  s.version        = '1.0.0'
  s.summary        = 'Saves and applies the app layout direction'
  s.description    = 'Saves the layout direction that the app decides and applies it to UIKit containers'
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
