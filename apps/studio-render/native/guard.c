#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* Fixed execution-service supervisor. COMMAND is trusted image configuration,
 * never request input. Production COMMAND is the namespace launcher. */
static volatile sig_atomic_t stopped = 0;
static void stop(int sig) { (void)sig; stopped = 1; }
static int64_t now_ms(void) {
  struct timespec t;
  if (clock_gettime(CLOCK_MONOTONIC, &t)) _exit(126);
  return (int64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}
static long number(const char *s, long max) {
  char *end; errno = 0;
  long n = strtol(s, &end, 10);
  if (errno || *end || n < 1 || n > max) _exit(126);
  return n;
}
static int forward(int fd, const char *data, size_t len, int64_t deadline) {
  while (len) {
    if (stopped || now_ms() >= deadline) return -1;
    struct pollfd p = {fd, POLLOUT, 0};
    int ready = poll(&p, 1, 10);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0 || (ready > 0 && (p.revents & (POLLERR|POLLHUP)))) return -1;
    if (!ready) continue;
    ssize_t n = write(fd, data, len);
    if (n < 0 && (errno == EAGAIN || errno == EINTR)) continue;
    if (n <= 0) return -1;
    data += n; len -= (size_t)n;
  }
  return 0;
}
/* Subreaping makes orphaned setsid/double-fork children discoverable here.
 * Repeated nonblocking reap + kill covers intermediate parents dying between
 * snapshots. Never wait without the independent monotonic teardown deadline. */
static int teardown(pid_t child) {
  kill(-child,SIGKILL); kill(child,SIGKILL);
  int64_t deadline=now_ms()+1000;
  char path[80];
  snprintf(path,sizeof(path),"/proc/self/task/%ld/children",(long)getpid());
  while(now_ms()<deadline) {
    pid_t got=waitpid(-1,NULL,WNOHANG);
    if(got>0) continue;
    if(got<0 && errno==ECHILD) return 0;
    if(got<0 && errno!=EINTR) return -1;
    int fd=open(path,O_RDONLY|O_CLOEXEC);
    if(fd<0) return -1;
    char children[16384]; ssize_t count=read(fd,children,sizeof(children)-1); close(fd);
    if(count<0) return -1;
    children[count]=0;
    char *cursor=children,*end;
    while(*cursor) {
      long pid=strtol(cursor,&end,10);
      if(end==cursor) break;
      if(pid>0 && pid<=INT_MAX) kill((pid_t)pid,SIGKILL);
      cursor=end;
    }
    struct timespec pause={0,1000000}; nanosleep(&pause,NULL);
  }
  /* Caller MUST retire the whole execution container on this status; never
   * recycle a slot whose kernel tasks could not be confirmed dead. */
  return -1;
}
int main(int argc, char **argv) {
  int absolute = argc > 1 && strcmp(argv[1],"--deadline") == 0;
  if (absolute) {argc--;argv++;}
  if (argc < 6 || argv[4][0] != '-' || argv[4][1] != '-' || argv[4][2]) return 126;
  long timeout = number(argv[1], absolute ? LONG_MAX : 3600000);
  int64_t started = now_ms(), deadline = absolute ? timeout : started + timeout;
  if (deadline <= started) return 124;
  if (deadline - started > 3600000) return 126;
  long budget[2] = {number(argv[2], 268435456), number(argv[3], 65536)};
  int pipes[2][2];
  if (pipe2(pipes[0], O_CLOEXEC) || pipe2(pipes[1], O_CLOEXEC)) return 126;
  struct sigaction action = {0}; action.sa_handler = stop;
  sigaction(SIGTERM, &action, NULL); sigaction(SIGINT, &action, NULL);
  signal(SIGPIPE, SIG_IGN);
  if (prctl(PR_SET_CHILD_SUBREAPER, 1)) return 126;
  pid_t owner = getpid(), child = fork();
  if (child < 0) return 126;
  if (!child) {
    if (prctl(PR_SET_PDEATHSIG, SIGKILL) || getppid() != owner) _exit(126);
    if (setsid() < 0) _exit(126);
    int null = open("/dev/null", O_RDONLY);
    if (null < 0 || dup2(null, 0) < 0 || dup2(pipes[0][1], 1) < 0 || dup2(pipes[1][1], 2) < 0) _exit(126);
    close(null);
    for (int i=0;i<2;i++) {close(pipes[i][0]);close(pipes[i][1]);}
    execv(argv[5], &argv[5]); _exit(126);
  }
  for (int i=0;i<2;i++) {
    close(pipes[i][1]);
    if (fcntl(pipes[i][0], F_SETFL, O_NONBLOCK) < 0 || fcntl(i+1, F_SETFL, O_NONBLOCK) < 0) { return teardown(child) ? 127 : 126; }
  }
  int result = 0, status = 0, exited = 0, open_count = 2;
  struct pollfd fds[2] = {{pipes[0][0], POLLIN, 0}, {pipes[1][0], POLLIN, 0}};
  while (!exited || open_count) {
    if (stopped || now_ms() >= deadline) {result = stopped ? 130 : 124;break;}
    if (!exited) {
      pid_t got = waitpid(child, &status, WNOHANG);
      if (got == child) exited = 1;
      else if (got < 0 && errno != EINTR) {result=126;break;}
    }
    int ready = poll(fds, 2, 10);
    if (ready < 0 && errno == EINTR) continue;
    if (ready < 0) {result=126;break;}
    for (int i=0;i<2;i++) {
      if (fds[i].fd < 0 || !(fds[i].revents & (POLLIN|POLLHUP|POLLERR))) continue;
      char data[8192]; ssize_t n = read(fds[i].fd, data, sizeof(data));
      if (n < 0 && (errno == EAGAIN || errno == EINTR)) continue;
      if (n <= 0) {close(fds[i].fd);fds[i].fd=-1;open_count--;continue;}
      size_t keep = n > budget[i] ? (size_t)budget[i] : (size_t)n;
      if (forward(i+1, data, keep, deadline)) {result=stopped?130:124;break;}
      budget[i] -= (long)keep;
      if ((size_t)n > keep) {result=125;break;}
    }
    if (result) break;
  }
  /* bwrap --die-with-parent and private PID init make setsid/double-fork unable
   * to escape this kill. Process groups alone are not the containment boundary. */
  for (int i=0;i<2;i++) if (fds[i].fd >= 0) close(fds[i].fd);
  if(teardown(child)) return 127;
  if (result) return result;
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
