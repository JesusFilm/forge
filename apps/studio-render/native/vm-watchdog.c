#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/magic.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <stddef.h>
#include <sys/vfs.h>
#include <time.h>
#include <unistd.h>

/* Root-owned independent systemd service. Never shares the execution cgroup or
 * credentials. A frozen tombstone persists until trusted Docker reconciliation
 * confirms that no outstanding create/start can attach another process. */
static int64_t now_ms(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t)) _exit(126);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static int fixed_hex(const char *s, size_t n) {
  if (strlen(s) != n) return 0;
  for (size_t i=0;i<n;i++) if (!((s[i]>='0'&&s[i]<='9')||(s[i]>='a'&&s[i]<='f'))) return 0;
  return 1;
}
static int flag(int directory, const char *name) {
  int fd=openat(directory,name,O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  if(fd<0) return errno==ENOENT ? 0 : -1;
  struct stat s; int valid=!fstat(fd,&s)&&S_ISREG(s.st_mode)&&s.st_uid==0&&(s.st_mode&0077)==0;
  close(fd); return valid ? 1 : -1;
}
static int write_control(int directory, const char *name) {
  int fd=openat(directory,name,O_WRONLY|O_NOFOLLOW|O_CLOEXEC);
  if(fd<0) return -1;
  int result=write(fd,"1",1)==1 ? 0 : -1; close(fd); return result;
}
static int notify_ready(void) {
  const char *path=getenv("NOTIFY_SOCKET");
  struct sockaddr_un address={0}; address.sun_family=AF_UNIX;
  if(!path||strlen(path)>=sizeof(address.sun_path)) return -1;
  strcpy(address.sun_path,path);
  size_t length=offsetof(struct sockaddr_un,sun_path)+strlen(path)+1;
  if(path[0]=='@') {address.sun_path[0]=0;length--;}
  int fd=socket(AF_UNIX,SOCK_DGRAM|SOCK_CLOEXEC,0);
  if(fd<0) return -1;
  int result=sendto(fd,"READY=1",7,MSG_NOSIGNAL,(struct sockaddr*)&address,(socklen_t)length)==7?0:-1;
  close(fd);return result;
}
int main(int argc,char **argv) {
  if(getuid()!=0||geteuid()!=0||argc!=5||!fixed_hex(argv[1],32)||strlen(argv[2])!=36) return 126;
  char *end; errno=0; long long deadline=strtoll(argv[3],&end,10);
  if(errno||*end||deadline<1||deadline-now_ms()>900000) return 126;
  errno=0; unsigned long long inode=strtoull(argv[4],&end,10);
  if(errno||*end||inode<1) return 126;
  char state[180],group[220];
  snprintf(state,sizeof(state),"/var/lib/forge-studio/jobs/%s",argv[1]);
  snprintf(group,sizeof(group),"/sys/fs/cgroup/forge.slice/forge-studio.slice/forge-studio-j%s.slice",argv[1]);
  int directory=open(state,O_DIRECTORY|O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  struct stat info;
  if(directory<0||fstat(directory,&info)||info.st_uid!=0||(info.st_mode&0077)) return 126;
  int cg=open(group,O_DIRECTORY|O_RDONLY|O_NOFOLLOW|O_CLOEXEC);
  struct stat group_info; struct statfs fs;
  if(cg<0||fstat(cg,&group_info)||fstatfs(cg,&fs)||fs.f_type!=CGROUP2_SUPER_MAGIC||(unsigned long long)group_info.st_ino!=inode) return 126;
  char boot[40]={0}; int bootfd=open("/proc/sys/kernel/random/boot_id",O_RDONLY|O_CLOEXEC);
  if(bootfd<0||read(bootfd,boot,36)!=36) return 126;
  close(bootfd);
  int already_retired=flag(directory,"retired");
  if(already_retired<0) return 126;
  if(already_retired) return 0;
  int expired=memcmp(boot,argv[2],36)!=0||now_ms()>=deadline;
  int cancelled_at_start=flag(directory,"cancelled"), expired_at_start=flag(directory,"expired");
  if(cancelled_at_start<0||expired_at_start<0) return 126;
  expired=expired||cancelled_at_start||expired_at_start;
  /* A restarted deadline owner must keep its tombstone active until trusted
   * runtime reconciliation. Expiry closes admission; it is not retirement. */
  if(expired&&(write_control(cg,"cgroup.freeze")||write_control(cg,"cgroup.kill"))) return 126;
  /* Readiness acknowledges a validated retained identity/deadline, not that
   * runtime bounds or a successful render have already been proven. */
  int ready=openat(directory,"watchdog-ready",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
  if(ready>=0) { if(fsync(ready)) return 126; close(ready); if(fsync(directory)) return 126; }
  else if(errno!=EEXIST||flag(directory,"watchdog-ready")!=1) return 126;
  if(notify_ready()) return 126;
  for(;;) {
    int retired=flag(directory,"retired");
    if(retired<0) return 126;
    if(retired) return 0;
    struct stat current;
    if(lstat(group,&current)||(unsigned long long)current.st_ino!=inode) return 126;
    int cancelled=flag(directory,"cancelled");
    if(cancelled<0) return 126;
    expired=expired||cancelled||now_ms()>=deadline;
    if(expired) {
      int marker=openat(directory,"expired",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
      if(marker>=0) {
        if(fsync(marker)) return 126;
        close(marker); if(fsync(directory)) return 126;
      } else if(errno!=EEXIST||flag(directory,"expired")!=1) return 126;
      /* The launcher pre-creates this exact slice and keeps it required by
       * this service until every outstanding Docker operation is reconciled.
       * Keep the inode-bound descriptor; never accept a recreated group. */
      if(write_control(cg,"cgroup.freeze")||write_control(cg,"cgroup.kill")) return 126;
    }
    struct timespec pause={0,50000000}; nanosleep(&pause,NULL);
  }
}
