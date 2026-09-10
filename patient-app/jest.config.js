/** @type {import('@jest/types').Config.ProjectConfig} */
module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/test/setup.ts"],
  // CI and constrained development shells cannot initialize the global
  // Watchman LaunchAgent. Jest's node crawler is deterministic for this app.
  watchman: false,
}
