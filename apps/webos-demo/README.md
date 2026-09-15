# Watch TV webOS demo

A webOS TV demo designed for the LG webOS TV 26 Simulator. It uses a pinned,
vendored Shaka Player 5.2.8 bundle to play the real JESUS Mux HLS stream and its
English WebVTT subtitles through Media Source Extensions.

## Run in the simulator

1. Open the webOS TV 26 Simulator.
2. Select **File → Launch App** or click **App** on the simulator remote.
3. Choose this `apps/webos-demo` directory, where `appinfo.json` is located.

Use the simulator remote's directional buttons and OK button to move focus,
change the featured content, and play **JESUS** through Shaka Player. The player
screen exposes play/pause, English subtitle on/off, progress, and Back controls.

The Shaka bundle is vendored at `vendor/shaka-player.compiled.js` from
`shaka-player@5.2.8` so the simulator demo does not depend on a player CDN at
runtime. Video delivery still requires network access to Mux.
