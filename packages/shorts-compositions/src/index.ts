// Player-facing package root. Manager server/workflow code must NOT import
// this module — it pulls React/Remotion. Use the "./schema" and "./captions"
// subpath exports there instead.
export { Root } from "./Root"
export { ShortComposition } from "./templates/ShortComposition"
export {
  SHORT_TEMPLATES,
  type ShortTemplateDefaults,
  type ShortTemplateDefinition,
} from "./templates/registry"
export * from "./schema"
export { COMPOSITIONS_VERSION } from "./version"
