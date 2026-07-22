import {
  compareLanguagesBySpeakerCount,
  type WatchLanguageGlobeLocation,
  type WatchLanguageIndexLanguage,
} from "@/lib/language-index"

export type LanguageGlobeEntry = Pick<
  WatchLanguageIndexLanguage,
  "id" | "nativeLabel" | "englishLabel" | "href"
> & {
  latitude: number | null
  longitude: number | null
}

type GlobeCoordinates = Pick<
  WatchLanguageGlobeLocation,
  "latitude" | "longitude"
>

const MINIMUM_SEPARATION_DEGREES = 12

export function selectLanguageGlobeEntries(
  languages: WatchLanguageIndexLanguage[],
  requestedLimit: number,
  locationsByPublicSlug: Readonly<
    Record<string, WatchLanguageGlobeLocation[]>
  > = {},
): LanguageGlobeEntry[] {
  const limit = Math.round(Math.min(Math.max(requestedLimit, 4), 24))
  const selectedLocations: GlobeCoordinates[] = []
  const selectedRegions = new Set<string>()

  return [...languages]
    .sort(compareLanguagesBySpeakerCount)
    .slice(0, limit)
    .map((language) => {
      const locations = locationsByPublicSlug[language.publicSlug] ?? []
      const separated = locations.filter((candidate) =>
        selectedLocations.every(
          (selected) =>
            angularDistanceDegrees(candidate, selected) >=
            MINIMUM_SEPARATION_DEGREES,
        ),
      )
      const location =
        separated.find(
          (candidate) => !selectedRegions.has(candidate.regionName),
        ) ??
        separated[0] ??
        locations.find(
          (candidate) => !selectedRegions.has(candidate.regionName),
        ) ??
        locations[0] ??
        null

      if (location) {
        selectedLocations.push(location)
        selectedRegions.add(location.regionName)
      }

      return {
        id: language.id,
        nativeLabel: language.nativeLabel,
        englishLabel: language.englishLabel,
        href: language.href,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
      }
    })
}

function angularDistanceDegrees(
  a: GlobeCoordinates,
  b: GlobeCoordinates,
): number {
  const toRadians = Math.PI / 180
  const latitudeA = a.latitude * toRadians
  const latitudeB = b.latitude * toRadians
  const longitudeDelta = (a.longitude - b.longitude) * toRadians
  const cosine =
    Math.sin(latitudeA) * Math.sin(latitudeB) +
    Math.cos(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta)
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
}
