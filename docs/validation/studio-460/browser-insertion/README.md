# Library insertion and browser render — bounded evidence

The initial browser render succeeded with an **empty composition**: the library text insertion threw while reading a missing first track. That result is retained as empty-composition evidence only.

The corrected library selects a matching track kind and creates a missing track together with its item in one local edit. Save sends one canonical revision-checked `restore-document` operation batch. It does not fall back to an audio track for visual content or introduce a format/layout restriction.

The owned production Manager browser regression verifies:

- An audio-only document keeps its audio track and adds a matching visual track plus text in one batch, revision 1 to 2.
- A real retained WAV upload into a zero-track document adds its audio track and item in one batch.
- Two browser contexts edit revision 1. A title save wins revision 2; the losing insertion save conflicts and canonical tracks/items remain empty, with no orphan track.

The separate browser edit/save/enqueue/poll run rendered visible “Your text” through the real private execution service and retained the verified output for attempt `cmtrpzzg7000f2cq7h842o3ob`, revision 3. Its 214,763-byte MP4 SHA-256 is `b3e6caa79dd299b1c68f0c02ea81b61dc5eb4596c765a5310eec71878952095b`. Full independent decode succeeded; the extracted one-second frame shows the text. Codec proof records H.264 320×180, 30 fps, 150 frames / 5 seconds and AAC stereo 48 kHz. Browser errors were empty.

Owned fixture database is `forge_studio_460_browser` on loopback port 55460, with fresh migrations through 0087. Chrome is `/usr/bin/google-chrome`. Runtime, credentials and output MP4 remain outside the repo at `/home/tataihono/.cache/forge-studio-460-runtime/browser`. No sibling services or paid providers were used. Execution uses the previously measured local cgroup boundary; this is not Railway/container deployment acceptance.

Existing nonempty retained-source/custom-component/audio and full 231-second evidence remain separate and unchanged. The full-length fixture was not rerendered for this insertion change. Captured timing is a single observation, not a matched Manager/Watch performance comparison. Publication, Watch and final release acceptance remain outstanding.
