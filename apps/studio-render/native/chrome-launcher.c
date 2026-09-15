#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Chromium parks encoded video frames in one growing temporary file. Bound
 * its allocator below RLIMIT_FSIZE (128 MiB), without relaxing any job limit.
 * Remotion owns the other arguments; preserve its enabled features verbatim. */
int main(int argc, char **argv) {
  const char *prefix = "--enable-features=";
  const char *feature = "CompressParkableStrings:max_disk_capacity_mb/64";
  int index = argc;
  for (int i = 1; i < argc; i++) {
    if (strncmp(argv[i], prefix, strlen(prefix)) != 0) continue;
    if (index != argc || strstr(argv[i], "CompressParkableStrings")) return 126;
    index = i;
  }
  const char *existing = index == argc ? prefix : argv[index];
  const char *separator = strlen(existing) == strlen(prefix) ? "" : ",";
  size_t length = strlen(existing) + strlen(separator) + strlen(feature) + 1;
  char *features = malloc(length);
  char **args = calloc((size_t)argc + 2, sizeof(char *));
  if (!features || !args) return 126;
  snprintf(features, length, "%s%s%s", existing, separator, feature);
  for (int i = 1; i < argc; i++) args[i] = argv[i];
  args[0] = "/browser/chrome-headless-shell";
  args[index] = features;
  execv(args[0], args);
  return 126;
}
