# Admin IBM Plex fonts

The root layout loads these unmodified IBM Plex WOFF2 files locally. This removes
Google Fonts stylesheet and font downloads from the Admin build, preserving the
Sans 400/500/600 and Mono 400/500 weights, CSS variables and swap display.

Source: [IBM/plex](https://github.com/IBM/plex/tree/71f558992315a12ca1f06a2215d57962a1992162),
`packages/plex-{sans,mono}/fonts/complete/woff2/`. The complete files preserve the
upstream glyph repertoire rather than introducing a Latin-only subset. The five
files total 296,468 bytes before HTTP transfer encoding. OFL.txt contains the
upstream SIL Open Font License and copyright notices.

Next 16.3.8's Google loader failed in a Railway build with the same assertion
reported in [Next issue 99114](https://github.com/vercel/next.js/issues/99114).
The production log did not establish the exact Google response URL shape.
Local font loading avoids that external build input without changing the
repository's patched Next runtime. No later 16.3 patch was published when checked;
the upstream fix was merged to canary and active LTS, not verified in this
repository's installed release.

On updates, retain the license and pinned provenance, review file sizes, and run
the full Admin production build. Next emits local WOFF2 assets and preload links;
no Google font request should be required during that build.
