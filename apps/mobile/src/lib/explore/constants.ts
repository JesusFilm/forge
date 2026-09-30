/**
 * Dependency-free constants for the Explore tab. The tab layouts reach this
 * leaf through the gate, so it holds no logic and no import.
 */

/**
 * KTD16's over-the-air kill switch, on one line as a bare literal so a reader
 * and exploreGateWiring.guard both answer "is it on?" from this file. Off hides
 * the tab in every bundle, development bundles included.
 */
export const EXPLORE_ENABLED: boolean = true
