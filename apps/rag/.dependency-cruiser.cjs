module.exports = {
  forbidden: [
    {
      name: "contracts-are-pure",
      severity: "error",
      from: { path: "^src/contracts/" },
      to: { path: "^src/(?!contracts/)" },
    },
    ...["acquisition", "config", "indexing", "retrieval", "serving"].map(
      (lane) => ({
        name: `${lane}-stays-in-lane`,
        severity: "error",
        from: {
          path: `^src/${lane}/`,
          pathNot: "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
        },
        to: {
          path: "^src/",
          pathNot: `^src/(contracts|${lane})/`,
        },
      }),
    ),
    {
      name: "fakes-are-test-only",
      severity: "error",
      from: { path: "^src/(?!fakes/).*(?<!\\.(?:test|spec)\\.[cm]?[jt]sx?)$" },
      to: { path: "^src/fakes/" },
    },
    {
      name: "adapters-import-only-contracts",
      severity: "error",
      from: {
        path: "^src/adapters/",
        pathNot: "\\.(?:test|spec)\\.[cm]?[jt]sx?$",
      },
      to: { path: "^src/", pathNot: "^src/(contracts|adapters|generated)/" },
    },
    {
      name: "rag-does-not-import-other-apps",
      severity: "error",
      from: { path: "^src/" },
      to: {
        path: "^\\.\\./(?!\\.\\./packages/rag-contracts/)",
        pathNot: "^\\.\\./\\.\\./node_modules/",
      },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: { path: "^src/" },
      to: {
        couldNotResolve: true,
        pathNot: "^(?:@forge/rag-contracts|hono|hono/body-limit|tinyld)$",
      },
    },
    {
      name: "no-circular",
      severity: "error",
      from: { path: "^src/" },
      to: { circular: true },
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
        path: "^src/(?!(contracts|acquisition|config|indexing|retrieval|serving|adapters|fakes)/|main\\.ts$)",
      },
      to: { path: "^src/" },
    },
    {
      name: "tests-never-touch-adapters",
      severity: "error",
      from: {
        path: "(?:^tests/|\\.(?:test|spec)\\.[cm]?[jt]sx?$)",
        pathNot: "^(?:src/adapters/|tests/adapters\\.integration\\.test\\.ts$)",
      },
      to: { path: "^src/adapters/" },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    doNotFollow: { path: "(?:node_modules|^src/generated/)" },
  },
}
