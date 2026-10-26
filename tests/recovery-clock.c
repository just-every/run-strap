/* Process-local wall clock for the elapsed-week HTTP journey. No production
 * imports, application records, monotonic timers or host clock are changed.
 * Build: cc -shared -fPIC tests/recovery-clock.c -o /tmp/strap-clock.so
 * macOS: cc -dynamiclib tests/recovery-clock.c -o /tmp/strap-clock.dylib
 * Use LD_PRELOAD (Linux) or DYLD_INSERT_LIBRARIES (macOS), and
 * STRAP_RECOVERY_CLOCK (a file containing offset seconds).
 * No allocator or dynamic-linker initialization is needed in workerd. */
#define _GNU_SOURCE
#include <time.h>
#include <sys/time.h>
#ifndef __APPLE__
#include <sys/syscall.h>
#endif
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
extern char **environ;
static long offset(void) {
  const char *path = 0;
  for (char **p=environ; p && *p; ++p)
    if (!strncmp(*p,"STRAP_RECOVERY_CLOCK=",21)) {path=*p+21;break;}
  if (!path) return 0;
#ifdef __APPLE__
  int fd=open(path,O_RDONLY);
#else
  long fd=syscall(SYS_openat,AT_FDCWD,path,O_RDONLY,0);
#endif
  if (fd<0) return 0;
  char bytes[32];
#ifdef __APPLE__
  long n=read(fd,bytes,sizeof(bytes));close(fd);
#else
  long n=syscall(SYS_read,fd,bytes,sizeof(bytes));syscall(SYS_close,fd);
#endif
  long seconds=0,sign=1,i=0;
  if(n>0 && bytes[0]=='-'){sign=-1;i++;}else if(n>0 && bytes[0]=='+')i++;
  for(;i<n && bytes[i]>='0' && bytes[i]<='9';i++)seconds=seconds*10+bytes[i]-'0';
  return sign*seconds;
}
#ifdef __APPLE__
/* dyld leaves this image's references to the original functions intact. */
static int shifted_clock_gettime(clockid_t clock,struct timespec *out) {
  int result=clock_gettime(clock,out);
  if(!result && clock==CLOCK_REALTIME)out->tv_sec+=offset();
  return result;
}
static int shifted_gettimeofday(struct timeval *out,void *zone) {
  int result=gettimeofday(out,zone);
  if(!result && out)out->tv_sec+=offset();
  return result;
}
static time_t shifted_time(time_t *out) {
  time_t value=time(0)+offset();
  if(out)*out=value;
  return value;
}
#define INTERPOSE(replacement,original) \
  __attribute__((used)) static const struct { \
    const void *replace; const void *target; \
  } interpose_##original __attribute__((section("__DATA,__interpose"))) = { \
    (const void *)&replacement, (const void *)&original \
  }
INTERPOSE(shifted_clock_gettime,clock_gettime);
INTERPOSE(shifted_gettimeofday,gettimeofday);
INTERPOSE(shifted_time,time);
#else
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
#endif
