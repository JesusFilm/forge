# Delete This Directory When Prod Embeddings Work

This directory is temporary.

Delete `docs/search-eval-baselines/temporary/` after both conditions are true:

1. Production Admin query embeddings are healthy again.
2. Production Mastra can capture and export the seed baseline through the
   official authenticated export/import path.

These JSON files are sanitized eval snapshots, but they should not become a
long-term source of truth. Once production search eval capture works end to
end, regenerate a fresh baseline from production and remove these temporary
artifacts.

Cleanup reminder:

```bash
rm -rf docs/search-eval-baselines/temporary
```

Also update any local seed shortcut that points at this directory.
