# Local native startup and image qualification

The current native entrypoint rendered and independently verified a short composition in the owned namespace harness. The matching PID1 context rejected an ordinary unsealed record. The sealed record is evidence plus independent kernel checks, not cryptographic launcher identity. These results do not certify an OCI image or Railway deployment.

The two codec archives have different SHA256 values but byte-identical ffmpeg/ffprobe binaries; the exact comparison is retained here. The original archive remains the required named build context. Upstream daily releases expire after 14 days; IMAGE.md records the proposed retained supply dependency. No artifact upload occurred.

Official BuildKit v0.33.0 linux-amd64 archive SHA256: `b6242896d343100808dcbe37565caf381e0a444a6a83d7255926bb1519248ead`. Its rootless OCI worker started with native snapshotter and normal process sandbox. The frontend failed at runc devpts mounting with unmapped gid=5. This host lacks privileged newuidmap/newgidmap helpers; the task did not change host configuration and stopped its daemon. No Dockerfile RUN, completed image, registry push or remote build is claimed. See apps/studio-render/IMAGE.md for the proposed OCI-capable-runner path and separate runtime acceptance requirements.

The fresh owned database replayed all 97 migrations through 0087 and passed all 101 Studio tests. An initial fixture allowlist rejection was resolved by admitting only the exact task-owned fresh URL, preserving earlier restrictions. No shared or production database was used.
