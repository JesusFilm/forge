module.exports = {
  forbidden: [
    {
      name: "contracts-are-pure",
      severity: "error",
      from: { path: "^src/contracts/" },
      to: { path: "^src/(?!contracts/)" },
    },
    ...["acquisition", "indexing", "retrieval", "serving"].map((lane) => ({
      name: `${lane}-stays-in-lane`,
      severity: "error",
      from: { path: `^src/${lane}/` },
      to: {
        path: "^src/",
        pathNot: `^src/(contracts|${lane})/`,
      },
    })),
    {
      name: "adapters-import-only-contracts",
      severity: "error",
      from: { path: "^src/adapters/" },
      to: { path: "^src/(acquisition|indexing|retrieval|serving)/" },
    },
    {
      name: "only-main-is-the-composition-root",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/main\\.ts$" },
      to: { path: "^src/main\\.ts$" },
    },
    {
      name: "unclassified-modules-cannot-wire-internals",
      severity: "error",
      from: {
        path: "^src/(?!(contracts|acquisition|indexing|retrieval|serving|adapters)/|main\\.ts$)",
      },
      to: { path: "^src/" },
    },
    {
      name: "tests-never-touch-adapters",
      severity: "error",
      from: {
        path: "(?:^tests/|\\.(?:test|spec)\\.[cm]?[jt]sx?$)",
        pathNot: "^src/adapters/",
      },
      to: { path: "^src/adapters/" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "node_modules" },
  },
}
