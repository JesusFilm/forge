module.exports = {
  forbidden: [
    {
      name: "contracts-do-not-import-apps",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^\\.\\./\\.\\./apps/" },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: { path: "^src/" },
      to: { couldNotResolve: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
}
