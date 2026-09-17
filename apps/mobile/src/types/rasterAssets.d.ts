// The app declares no `*.png` module, and `tsconfig.json` sets `types: ["jest"]`.
// Each pattern types one raster the app imports (the splash and HomeLogo), so no
// declaration claims every image file.

declare module "*/splash-mark-white.png" {
  const asset: number
  export default asset
}

declare module "*/splash-mark-crimson.png" {
  const asset: number
  export default asset
}
