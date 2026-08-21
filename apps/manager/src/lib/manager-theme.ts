export const MANAGER_THEME_STORAGE_KEY = "forge-manager-theme"

export type ManagerTheme = "dark" | "light"

export function resolveManagerTheme(
  storedTheme: string | null,
  prefersDark: boolean,
): ManagerTheme {
  if (storedTheme === "dark" || storedTheme === "light") {
    return storedTheme
  }

  return prefersDark ? "dark" : "light"
}

export const MANAGER_THEME_INITIALIZER = `(() => {
  let storedTheme = null;
  try {
    storedTheme = localStorage.getItem("${MANAGER_THEME_STORAGE_KEY}");
  } catch {
    // System preference still applies when storage is unavailable.
  }
  const theme = storedTheme === "dark" || storedTheme === "light"
    ? storedTheme
    : matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.themeSource = storedTheme === "dark" || storedTheme === "light"
    ? "user"
    : "system";
})();`
