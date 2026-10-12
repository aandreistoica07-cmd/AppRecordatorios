require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'AlarmkitPlugin'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = 'https://capacitorjs.com'
  s.author = package['author']
  s.source = { :git => 'https://github.com/aandreistoica07-cmd/AppRecordatorios.git', :tag => package['version'] }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '26.0'
  s.dependency 'Capacitor'
  s.frameworks = 'Foundation', 'SwiftUI'
  s.weak_frameworks = 'AlarmKit'
  s.swift_version = '5.9'
end
