/**
 * This app declares no `*.png` module and `tsconfig.json` sets
 * `types: ["jest"]`, so Metro's own untyped `require` is out of scope too.
 * The two patterns below are deliberately narrow: they type this unit's own
 * rasters without claiming every image in the app from a component directory.
 * The declarations belong beside the wider `src/types/` ones once anything
 * else in the app imports a raster.
 */

declare module "*/splash-mark-white.png" {
  const asset: number
  export default asset
}

declare module "*/splash-mark-crimson.png" {
  const asset: number
  export default asset
}
