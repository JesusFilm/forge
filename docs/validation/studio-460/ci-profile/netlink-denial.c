#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <sys/socket.h>
ssize_t sendto(int fd, const void *buffer, size_t length, int flags, const struct sockaddr *address, socklen_t address_length) {
  ssize_t (*original)(int,const void*,size_t,int,const struct sockaddr*,socklen_t) = dlsym(RTLD_NEXT,"sendto");
  if (address && address->sa_family == AF_NETLINK && length >= sizeof(struct nlmsghdr) && ((const struct nlmsghdr*)buffer)->nlmsg_type == RTM_NEWADDR) {errno=EPERM; return -1;}
  return original(fd,buffer,length,flags,address,address_length);
}
