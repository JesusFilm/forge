# Served snapshot local writer measurement

This isolated PostgreSQL measurement used representative immutable JSON from the existing storage fixture, 100 requests each at 1, 6 and 20 items, and actual Prisma nested request/item creates through the new packing helper. Parent and child tables carried cloned indexes and the deferred payload integrity trigger. The clone did not copy foreign keys or unrelated application triggers, so these times are local evidence, not a production forecast. Each variant reconstructed all snapshots without missing values. The raw output is in `2026-09-30-feat-574-served-prisma-writer-local.json`.

| Items per request | Legacy bytes | Packed bytes | Change | Legacy WAL | Packed WAL | Legacy median write | Packed median write |
| ----------------- | -----------: | -----------: | -----: | ---------: | ---------: | ------------------: | ------------------: |
| 1                 |      491,520 |      516,096 |  +5.0% |    298,384 |    310,104 |             4.48 ms |             4.62 ms |
| 6                 |    1,449,984 |      729,088 | −49.7% |  1,260,128 |    884,448 |             6.66 ms |             7.51 ms |
| 20                |    4,153,344 |    1,613,824 | −61.1% |  4,076,696 |  1,882,904 |            12.26 ms |            25.13 ms |

The 1-item regression prompted a writer rule: packed mode keeps one-item slates inline. The 6/20-item cases show material storage/WAL gains with higher commit latency, especially at 20 items due to deferred membership checks after every child insertion. Those checks are retained as an integrity gate. The request-level flag remains off by default until mixed readers have been deployed and a rollback image with mixed-reader support is available.
