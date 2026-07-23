# 3D Earth Language Orbit assets

All runtime assets are served locally under the Watch `/watch` base path. The
scene does not use Troika's external font or Unicode-fallback CDN.

## Earth imagery

Credit: NASA/Goddard Space Flight Center Scientific Visualization Studio. Blue
Marble Next Generation data courtesy of Reto Stockli (NASA/GSFC) and NASA's
Earth Observatory.

- Source page: https://svs.gsfc.nasa.gov/3615/
- Cloudless source:
  https://svs.gsfc.nasa.gov/vis/a000000/a003600/a003615/earth_noClouds.0330.jpg
  (`2048×1024`, 356,461 bytes)
- Cloud-composite source:
  https://svs.gsfc.nasa.gov/vis/a000000/a003600/a003615/flat_earth03.jpg
  (`2048×1024`, 519,584 bytes)
- NASA media/reproduction guidance:
  https://www.nasa.gov/nasa-brand-center/images-and-media/

Runtime transformations:

```sh
cwebp -q 88 -m 6 earth_noClouds.0330.jpg -o earth-day.webp
cwebp -q 86 -m 6 flat_earth03.jpg -o earth-clouds.webp
cwebp -q 80 -m 6 -resize 1280 640 flat_earth03.jpg -o earth-fallback.webp
```

Runtime outputs:

- `earth-day.webp`: `2048×1024`, 179,554 bytes. Color-managed albedo with
  topographic shading already present in the NASA source.
- `earth-clouds.webp`: `2048×1024`, 255,990 bytes. The cloud shader compares
  this composite with `earth-day.webp` and derives a white alpha layer from
  their color difference; land/ocean pixels remain transparent.
- `earth-fallback.webp`: `1280×640`, 101,048 bytes. Static no-WebGL poster.

## Fonts

The source fonts are Noto Sans and Noto Sans Arabic from the Google Fonts
repository, licensed under the SIL Open Font License 1.1. The license text is
stored at `apps/web/public/fonts/language-orbit/OFL.txt`.

- Noto Sans source:
  https://github.com/google/fonts/blob/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf
- Noto Sans Arabic source:
  https://github.com/google/fonts/blob/main/ofl/notosansarabic/NotoSansArabic%5Bwdth%2Cwght%5D.ttf

The checked-in files are deterministic HarfBuzz subsets:

```sh
hb-subset NotoSans-Variable.ttf \
  --output-file=NotoSansOrbit.ttf \
  --unicodes='U+0020-007E,U+00A0-024F,U+1E00-1EFF,U+2000-206F' \
  --variations='wdth=75,wght=800'
hb-subset NotoSansArabic-Variable.ttf \
  --output-file=NotoSansArabicOrbit.ttf \
  --unicodes='U+0020-007E,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+2000-206F' \
  --variations='wdth=75,wght=800'
```

- `NotoSansOrbit.ttf`: 81,980 bytes
- `NotoSansArabicOrbit.ttf`: 135,248 bytes

The visual orbit renders supported Latin and Arabic labels with these local
fonts. Labels in other scripts use their existing English label in the
decorative orbit, while the stable semantic link keeps both the native and
English names.
