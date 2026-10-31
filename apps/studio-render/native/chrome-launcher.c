#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Bound parked-image storage below RLIMIT_FSIZE (128 MiB) and compositor
 * tiles inside the aggregate 2 GiB cgroup. The SDK's 4096 MiB tile allowance
 * exceeds that entire cgroup. These policies do not cap total browser RSS.
 * Preserve the selected compositor backend and enabled features verbatim. */
int main(int argc, char **argv) {
  const char *prefix = "--enable-features=";
  const char *tile_prefix = "--force-gpu-mem-available-mb=";
  const char *feature = "CompressParkableStrings:max_disk_capacity_mb/64";
  int index = -1;
  int tile_index = -1;
  for (int i = 1; i < argc; i++) {
    if (strncmp(argv[i], tile_prefix, strlen(tile_prefix)) == 0) {
      if (tile_index != -1) return 126;
      tile_index = i;
    }
    if (strncmp(argv[i], prefix, strlen(prefix)) != 0) continue;
    if (index != -1 || strstr(argv[i], "CompressParkableStrings")) return 126;
    index = i;
  }
  const char *existing = index == -1 ? prefix : argv[index];
  const char *separator = strlen(existing) == strlen(prefix) ? "" : ",";
  size_t length = strlen(existing) + strlen(separator) + strlen(feature) + 1;
  char *features = malloc(length);
  char **args = calloc((size_t)argc + 3, sizeof(char *));
  if (!features || !args) return 126;
  snprintf(features, length, "%s%s%s", existing, separator, feature);
  for (int i = 1; i < argc; i++) args[i] = argv[i];
  args[0] = "/browser/chrome-headless-shell";
  int next = argc;
  if (index == -1) index = next++;
  if (tile_index == -1) tile_index = next++;
  args[index] = features;
  args[tile_index] = "--force-gpu-mem-available-mb=256";
  execv(args[0], args);
  return 126;
}
