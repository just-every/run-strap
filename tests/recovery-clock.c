/* Process-local wall clock for the elapsed-week HTTP journey. No production
 * imports, application records, monotonic timers or host clock are changed.
 * Build: cc -shared -fPIC tests/recovery-clock.c -o /tmp/strap-clock.so
 * Use LD_PRELOAD and STRAP_RECOVERY_CLOCK (a file containing offset seconds).
 * Raw syscalls avoid allocator/dlsym initialization cycles in workerd. */
#define _GNU_SOURCE
#include <time.h>
#include <sys/time.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
extern char **environ;
static long offset(void) {
  const char *path = 0;
  for (char **p=environ; p && *p; ++p)
    if (!strncmp(*p,"STRAP_RECOVERY_CLOCK=",21)) {path=*p+21;break;}
  if (!path) return 0;
  long fd=syscall(SYS_openat,AT_FDCWD,path,O_RDONLY,0);
  if (fd<0) return 0;
  char bytes[32];long n=syscall(SYS_read,fd,bytes,sizeof(bytes));syscall(SYS_close,fd);
  long seconds=0,sign=1,i=0;
  if(n>0 && bytes[0]=='-'){sign=-1;i++;}else if(n>0 && bytes[0]=='+')i++;
  for(;i<n && bytes[i]>='0' && bytes[i]<='9';i++)seconds=seconds*10+bytes[i]-'0';
  return sign*seconds;
}
int clock_gettime(clockid_t clock,struct timespec *out) {
  int result=syscall(SYS_clock_gettime,clock,out);
  if(!result && clock==CLOCK_REALTIME)out->tv_sec+=offset();
  return result;
}
int gettimeofday(struct timeval *out,void *zone) {
  int result=syscall(SYS_gettimeofday,out,zone);
  if(!result && out)out->tv_sec+=offset();
  return result;
}
time_t time(time_t *out) {
  struct timespec ts;clock_gettime(CLOCK_REALTIME,&ts);
  if(out)*out=ts.tv_sec;
  return ts.tv_sec;
}
