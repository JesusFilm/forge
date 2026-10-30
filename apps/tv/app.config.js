/* global module */
module.exports = ({ config }) => {
  if (process.env.TV_STARTUP_QA !== "1") return config
  return {
    ...config,
    name: "Watch Startup QA",
    scheme: "org.jesusfilm.startupqa",
    android: { ...config.android, package: "org.jesusfilm.tv.startupqa" },
  }
}
