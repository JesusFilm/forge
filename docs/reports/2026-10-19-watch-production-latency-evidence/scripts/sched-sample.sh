# Read-only scheduler sample of the Web main thread (pid 20) and host/cgroup context. Prints no secrets.
P=20
snap() {
  echo "utc=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
  echo "schedstat=$(cat /proc/$P/task/$P/schedstat)"
  grep -E '^(voluntary|nonvoluntary)_ctxt_switches' /proc/$P/task/$P/status | tr '\n' ' '; echo
  grep -E '^(procs_running|procs_blocked)' /proc/stat | tr '\n' ' '; echo
  echo "cpu_line=$(head -1 /proc/stat)"
  echo "loadavg=$(cat /proc/loadavg)"
  echo "cg_cpu_stat=$(tr '\n' ' ' < /sys/fs/cgroup/cpu.stat)"
  echo "cg_cpu_pressure=$(tr '\n' ' ' < /sys/fs/cgroup/cpu.pressure)"
  [ -r /proc/pressure/cpu ] && echo "host_cpu_pressure=$(tr '\n' ' ' < /proc/pressure/cpu)"
}
echo "== static"
grep -E '^(Cpus_allowed_list|Threads)' /proc/$P/status | tr '\n' ' '; echo
echo "nproc=$(nproc) online=$(cat /sys/devices/system/cpu/online)"
for f in cpu.max cpu.weight cpu.weight.nice cpuset.cpus.effective cpuset.cpus cpu.max.burst cgroup.type; do [ -r /sys/fs/cgroup/$f ] && echo "$f=$(cat /sys/fs/cgroup/$f)"; done
echo "proc1_cgroup=$(cat /proc/1/cgroup)"
grep -E '^(policy|prio|se.load.weight|nr_switches)' /proc/$P/sched 2>/dev/null | tr -s ' ' | tr '\n' ';'; echo
awk '{print "nice="$19" sched_policy="$41" processor_last="$39}' /proc/$P/stat
echo "== t0"; snap; sleep 10; echo "== t1"; snap
