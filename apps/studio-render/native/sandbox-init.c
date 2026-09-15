#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Runs after Bubblewrap created namespaces and dropped capabilities. No path or
 * process settings are accepted from a render request. Linux x86_64 image only. */
#define DENY(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, (n), 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM)
int main(void) {
  if (getuid() == 0 || geteuid() == 0) return 126;
  /* Libraries must size pools for this job, not the much larger host. The
   * seccomp filter below prevents authored code widening the inherited mask. */
  cpu_set_t available, bounded;
  CPU_ZERO(&available); CPU_ZERO(&bounded);
  if (sched_getaffinity(0,sizeof(available),&available)) return 126;
  int selected=0;
  for (int cpu=0;cpu<CPU_SETSIZE && selected<2;cpu++)
    if (CPU_ISSET(cpu,&available)) { CPU_SET(cpu,&bounded); selected++; }
  if (!selected || sched_setaffinity(0,sizeof(bounded),&bounded)) return 126;
  struct rlimit tasks = {96,96}, files={256,256}, output={134217728,134217728}, core={0,0};
  if (setrlimit(RLIMIT_NPROC,&tasks) || setrlimit(RLIMIT_NOFILE,&files) || setrlimit(RLIMIT_FSIZE,&output) || setrlimit(RLIMIT_CORE,&core)) return 126;
  if (prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)) return 126;
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data,arch)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AUDIT_ARCH_X86_64,1,0),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
    /* Reject x32 syscall ABI too. */
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,0x40000000,0,1),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    DENY(__NR_sched_setaffinity),
    DENY(__NR_unshare), DENY(__NR_setns), DENY(__NR_mount), DENY(__NR_umount2),
    DENY(__NR_pivot_root), DENY(__NR_ptrace), DENY(__NR_process_vm_readv), DENY(__NR_process_vm_writev),
    DENY(__NR_setuid), DENY(__NR_setreuid), DENY(__NR_setresuid), DENY(__NR_setfsuid),
    DENY(__NR_setgid), DENY(__NR_setregid), DENY(__NR_setresgid), DENY(__NR_setfsgid), DENY(__NR_setgroups),
    /* clone3's pointed-to flags cannot be inspected by classic BPF. ENOSYS
     * allows pinned glibc to fall back to clone for normal thread creation. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_clone3,0,1),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|ENOSYS),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,__NR_clone,0,3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,CLONE_NEWUSER|CLONE_NEWNS|CLONE_NEWPID|CLONE_NEWNET|CLONE_NEWIPC|CLONE_NEWUTS|CLONE_NEWCGROUP,0,1),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = {sizeof(filter)/sizeof(filter[0]),filter};
  if (prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&program)) return 126;
  char *args[] = {"/runtime/node","--max-old-space-size=256","/runtime/child.mjs",NULL};
  char *env[] = {"HOME=/tmp","PATH=/usr/bin:/bin","PWD=/input","TMPDIR=/tmp",NULL};
  execve(args[0],args,env); return 126;
}
