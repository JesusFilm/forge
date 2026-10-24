import "server-only"

// Server-only re-export for next-intl request configuration. Middleware and
// client-safe route helpers import the generated module directly, avoiding
// filesystem discovery in edge/client bundles.
export {
  AVAILABLE_UI_LOCALES,
  DEFAULT_LOCALE,
  hasUiLocale,
  type UiLocale,
} from "./generated-ui-locales"
