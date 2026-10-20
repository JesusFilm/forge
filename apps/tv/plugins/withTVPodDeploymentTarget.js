/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withPodfile } = require("expo/config-plugins")

const marker = "# Watch TV Pod deployment minimum"

function patchPodfile(contents, minimum) {
  if (contents.includes(marker)) return contents
  const anchor = "post_install do |installer|"
  if (!contents.includes(anchor)) {
    throw new Error("TV Pod deployment fix requires a post_install block")
  }
  return contents.replace(
    anchor,
    `${anchor}
    ${marker}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |configuration|
        value = configuration.build_settings['TVOS_DEPLOYMENT_TARGET']
        if value && Gem::Version.new(value) < Gem::Version.new('${minimum}')
          configuration.build_settings['TVOS_DEPLOYMENT_TARGET'] = '${minimum}'
        end
      end
    end`,
  )
}

module.exports = function withTVPodDeploymentTarget(config) {
  const tvPlugin = config.plugins.find(
    (plugin) =>
      Array.isArray(plugin) && plugin[0] === "@react-native-tvos/config-tv",
  )
  const minimum = tvPlugin?.[1]?.tvosDeploymentTarget
  if (!/^\d+\.\d+(\.\d+)?$/.test(minimum ?? "")) {
    throw new Error("TV Pod deployment fix requires tvosDeploymentTarget")
  }
  return withPodfile(config, (cfg) => {
    cfg.modResults.contents = patchPodfile(cfg.modResults.contents, minimum)
    return cfg
  })
}

module.exports.patchPodfile = patchPodfile
