# Retained codec inputs

`source-fixture-0.ts.body` contains the original MPEG-TS bytes. Its suffix prevents
code formatters from parsing binary transport-stream media as TypeScript. The
preserved HLS playlist references `source-fixture-0.ts`; copy these unchanged bytes
to that name in a disposable reproduction directory when running the playlist.
The original task-local filename and commands in `same-bytes-reproduction.json`
remain accurate. No original media bytes were changed by this artifact naming.
