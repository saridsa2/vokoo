/** @type {import('@babel/core').TransformOptions} */
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
    /**
     * The vendored AntV tree compiles against AntV's JSX runtime, not React's.
     *
     * Its components return `{ type, props }` description objects rather than
     * React elements — that is what lets ~20k lines of their geometry run
     * unchanged on React Native. Metro must be told, per directory, which
     * runtime to hand those files, or it silently compiles them into React
     * elements that nothing can draw.
     */
    overrides: [
      {
        test: /app[\\/]vendor[\\/]antv[\\/]/,
        plugins: [
          [
            "@babel/plugin-transform-react-jsx",
            { runtime: "automatic", importSource: "@/vendor/antv" },
          ],
        ],
      },
    ],
  }
}
