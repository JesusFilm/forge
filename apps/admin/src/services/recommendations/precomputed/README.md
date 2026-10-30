# Producer source-set digest

For the `start` action, `sourceSetDigest` is the lowercase hex SHA-256 of the
UTF-8 bytes of `JSON.stringify([...sourceVideoIds].sort())`. Use JavaScript's
default `sort()` (UTF-16 code-unit order), without a locale comparator or
PostgreSQL `ORDER BY`. `sourceVideoIds` contains each canonical source Video ID
exactly once, including sources with zero accepted connections. Set
`expectedSourceCount` to that array's length.

For example, `Video-B` sorts before `video-2`, `video-a`, and `video_1` with
JavaScript's default ordering. The producer can submit sources in any order;
completion sorts the stored IDs with the same rule before verifying the digest.
