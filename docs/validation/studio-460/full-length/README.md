> Historical validation summary. Raw artifact paths and original checksum inventories below refer to the [preserved archive](../../STUDIO-ARCHIVE.md); they are not a current checkout file inventory. Test fixtures remain in Git.

# Full-length contained composition proof (WIP)

2026-09-08. This is local runtime evidence, not Railway deployment, provider generation/Mux readiness, or final Watch acceptance.

The complete synthetic **231-second** composition has 6,930 frames at 1080×1920/30 fps, 77 sequential captions, a versioned animated React component, and retained 48 kHz tone audio at gain 0.5. `frame115.png` shows caption 39/77 and the custom component. No paid/provider calls were made. This exercises duration and runtime throughput, not devotional creative quality. Retained HLS trim/decode has separate short-composition evidence.

| Measurement                         |                                          Result |
| ----------------------------------- | ----------------------------------------------: |
| Render wall time                    |                                 622.186 seconds |
| Independent full codec verification |                                  30.306 seconds |
| Sum of measured phases              |                                 652.492 seconds |
| Render CPU usage delta              |                             686.924 CPU seconds |
| Render peak cgroup memory           |                               863,707,136 bytes |
| Verification peak cgroup memory     |                               116,137,984 bytes |
| Output                              |                                10,773,384 bytes |
| H264 video                          |               Exactly 6,930 frames / 231,000 ms |
| AAC audio                           |                  48 kHz stereo / 231,061.333 ms |
| Audio at 0.1, 115, 230 seconds      | RMS ≈0.044166, 880 Hz, consistent with gain 0.5 |
| OOM events                          |                                            Zero |

Output SHA-256: `59507e6df01c799eabd0f9cf6e5ba92f42f617c77ee012489b1a72bd0d939aaa`.

Both phases ran with systemd-user cgroup limits **2 GiB memory, zero swap, 2 CPU quota, 128 aggregate tasks**, plus native child PID96, file/output128MiB, readonly inputs, private network/user/PID/mount namespaces, a two-CPU inherited affinity mask that the child cannot widen, and native monotonic teardown. The existing 60-second profile timed out on the full fixture. Earlier trials also exposed encoder startup failure with automatic thread pools; the successful exact child uses one FFmpeg decoder/encoder/filter thread. `child-throughput.mjs` preserves the tested child, including bounded progress diagnostics. The actual output was not shortened to fit the proof budget.

FFmpeg verification/remux archive is the reviewed BtbN n9.0.1-27-g9b0578816c-20260907 archive, SHA-256 `da49baa2fd544ac090fa8adac19d2d6d1f781e75556c4f95dcc0a4f2dd22b1a6`. Remotion4.0.475 retains its separately pinned internal encoder. Node24.20.0, Chromium149.0.7790.0, Bubblewrap0.11.1. See the exact probes and logs here; their absolute paths identify this owned worktree/runtime. The full render and independent verification were measured as separate runs, not as one HTTP request.

## Authorized production execution profile

- One **900-second cumulative** native deadline from reservation through staging, render, independent verification and response delivery; staging upload itself remains capped at10seconds. No fresh verifier budget resets the job clock.
- Existing native cleanup grace1second and whole-container retirement grace2seconds. Failure to confirm cleanup retires the service; it cannot reuse the slot.
- Preserve2CPU/2GiB/no-swap/128aggregate tasks/96child tasks,128MiB decoded input/output, and bounded volatile mounts.
- Broker request timeout920seconds over dedicated **private service networking**; browser requests enqueue and return immediately, then poll canonical durable status.
- Durable queue lease1200seconds accommodates bounded90-second input preparation,900-second execution,60-second retention and scheduling/network margin. Lease expiry/restart fences old completions and retains late results. Mux processing/readiness is a later distinct phase.

Root authorized this profile for code on2026-09-08. Shared versioned constants now bind queued snapshots, signed admissions, native service deadlines and the dedicated private transport; final integrated service/queue validation remains pending. This is not a claim that the profile is deployed or accepted. Railway's [public HTTP limits](https://docs.railway.com/networking/public-networking/specs-and-limits), checked2026-09-08, allow15minutes with transferring data but close after5minutes of silence. A long silent render must not run through that public edge. No infrastructure settings were changed.
