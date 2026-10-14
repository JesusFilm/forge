Pod::Spec.new do |s|
  s.name = 'TopShelf'
  s.version = '0.1.0'
  s.summary = 'Watch TV Top Shelf snapshot bridge'
  s.description = 'Writes bounded snapshots shared with the tvOS extension.'
  s.license = { :type => 'MIT' }
  s.author = 'Jesus Film Project'
  s.homepage = 'https://www.jesusfilm.org/'
  s.platforms = { :tvos => '15.1' }
  s.swift_version = '5.9'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'TVServices'
  s.source_files = '**/*.swift'
end
