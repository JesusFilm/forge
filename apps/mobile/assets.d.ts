// Static image assets resolve to a Metro asset-registry id (number).
// expo-image and RN Image both accept it as a `source`.
declare module "*.png" {
  const asset: number
  export default asset
}
