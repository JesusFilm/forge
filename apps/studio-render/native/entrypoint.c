#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/capability.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Image entrypoint, never a request-controlled command. All descendants share
 * the new user namespace's inherited NPROC ceiling, including Node's threads.
 * CPU/memory/no-swap remain independently enforced by the service cgroup. */
static const char *record = "{\"version\":1,\"aggregateTasks\":128,\"uid\":1000}\n";
static void reject(void) { _exit(78); }
static void write_exact(const char *path, const char *value) {
  int fd = open(path, O_WRONLY | O_CLOEXEC);
  size_t size = strlen(value);
  if (fd < 0 || write(fd, value, size) != (ssize_t)size || close(fd)) reject();
}
int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--verify-record") == 0) {
    char name[80], contents[128];
    int required = F_SEAL_SEAL|F_SEAL_SHRINK|F_SEAL_GROW|F_SEAL_WRITE;
    ssize_t size = readlink("/proc/self/fd/3",name,sizeof(name)-1);
    if (getppid() != 1 || size < 0) reject();
    name[size] = 0;
    if (strcmp(name,"/memfd:studio-startup (deleted)") ||
        fcntl(3,F_GET_SEALS) != required ||
        pread(3,contents,sizeof(contents),0) != (ssize_t)strlen(record) ||
        memcmp(contents,record,strlen(record))) reject();
    return 0;
  }
  uid_t uid = getuid(); gid_t gid = getgid();
  if (argc != 1 || getpid() != 1 || uid == 0 || gid == 0 ||
      uid != geteuid() || gid != getegid()) reject();
  const char *key = getenv("STUDIO_RENDER_BROKER_PUBLIC_KEY");
  const char *port = getenv("PORT");
  if (!key || strlen(key) > 4096 || (port && strlen(port) > 5)) reject();
  char *saved_key = strdup(key), *saved_port = strdup(port ? port : "3330");
  if (!saved_key || !saved_port) reject();
  struct rlimit processes = {128,128}, core = {0,0};
  if (setrlimit(RLIMIT_NPROC, &processes) || setrlimit(RLIMIT_CORE, &core)) reject();
  if (unshare(CLONE_NEWUSER)) reject();
  char mapping[80];
  snprintf(mapping, sizeof(mapping), "1000 %u 1\n", (unsigned)uid);
  write_exact("/proc/self/uid_map", mapping);
  write_exact("/proc/self/setgroups", "deny\n");
  snprintf(mapping, sizeof(mapping), "1000 %u 1\n", (unsigned)gid);
  write_exact("/proc/self/gid_map", mapping);
  if (getuid() != 1000 || geteuid() != 1000 || getgid() != 1000) reject();
  if (unshare(CLONE_NEWNS) || mount(NULL,"/",NULL,MS_REC|MS_PRIVATE,NULL) ||
      mount("tmpfs","/work","tmpfs",MS_NOSUID|MS_NODEV,"size=268435456,mode=0700")) reject();
  struct __user_cap_header_struct header = {_LINUX_CAPABILITY_VERSION_3,0};
  struct __user_cap_data_struct capabilities[2] = {{0,0,0},{0,0,0}};
  if (syscall(SYS_capset,&header,&capabilities) || prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)) reject();
  /* A sealed inherited descriptor records the native path, never an environment
   * claim. Main additionally checks the current kernel limits and credentials. */
  int proof = memfd_create("studio-startup",MFD_ALLOW_SEALING);
  if (proof < 0 || write(proof,record,strlen(record)) != (ssize_t)strlen(record) ||
      fcntl(proof,F_ADD_SEALS,F_SEAL_SEAL|F_SEAL_SHRINK|F_SEAL_GROW|F_SEAL_WRITE) ||
      lseek(proof,0,SEEK_SET) < 0 || (proof != 3 && dup2(proof,3) < 0)) reject();
  if (proof != 3) close(proof);
  if (syscall(SYS_close_range,4,~0U,0) || clearenv() ||
      setenv("STUDIO_RENDER_BROKER_PUBLIC_KEY",saved_key,1) ||
      setenv("PORT",saved_port,1)) reject();
  umask(0077);
  char *args[] = {"/runtime/node","/opt/studio-render/main.mjs",NULL};
  execv(args[0],args); reject();
}
