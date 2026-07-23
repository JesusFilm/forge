export type LanguageOrbitPhase = {
  getEarthRotationY: () => number
  getCloudRotationY: () => number
  getOrbitRotationY: () => number
  getStarTime: () => number
  setEarthRotationY: (rotationY: number) => void
  setCloudRotationY: (rotationY: number) => void
  setOrbitRotationY: (rotationY: number) => void
  setStarTime: (time: number) => void
}

export const DEFAULT_INITIAL_LONGITUDE = -100

export function createLanguageOrbitPhase(
  initialLongitude = DEFAULT_INITIAL_LONGITUDE,
): LanguageOrbitPhase {
  let earthRotationY = degreesToRadians(initialLongitude)
  let cloudRotationY = degreesToRadians(initialLongitude + 2)
  let orbitRotationY = -Math.PI / 2
  let starTime = 0

  return {
    getEarthRotationY: () => earthRotationY,
    getCloudRotationY: () => cloudRotationY,
    getOrbitRotationY: () => orbitRotationY,
    getStarTime: () => starTime,
    setEarthRotationY: (rotationY) => {
      earthRotationY = rotationY
    },
    setCloudRotationY: (rotationY) => {
      cloudRotationY = rotationY
    },
    setOrbitRotationY: (rotationY) => {
      orbitRotationY = rotationY
    },
    setStarTime: (time) => {
      starTime = time
    },
  }
}

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}
