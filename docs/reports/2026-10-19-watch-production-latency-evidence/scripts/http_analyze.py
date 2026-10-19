"""Summarize Railway HTTP logs: arrivals vs completions, in-flight depth, durations by class.
Usage: python3 -I http_analyze.py <raw.jsonl>  (prints sanitized summary JSON; never prints srcIp/UA)"""
import json, sys, statistics
from datetime import datetime, timedelta
rows=[]
for line in open(sys.argv[1]):
    try: r=json.loads(line)
    except Exception: continue
    ts=datetime.fromisoformat(r["timestamp"].replace("Z","")[:26])
    d=r.get("totalDuration") or 0
    rows.append((ts-timedelta(milliseconds=d), ts, d, r.get("path",""), r.get("httpStatus"), r.get("deploymentInstanceId"), r.get("method")))
rows.sort()
def cls(p):
    if p.startswith("/watch/api/"): return "watch_api"
    if p.startswith("/watch/_next/") or p.startswith("/watch/assets/"): return "static"
    if p in ("/watch","/watch/"): return "watch_root"
    if p.startswith("/watch"): return "watch_page"
    return "other"
lo=max(r[1] for r in rows[:1]); 
t0=min(r[1] for r in rows); t1=max(r[1] for r in rows)
# only consider arrivals inside the fully-observed completion window (arrival >= t0 and completion <= t1 is guaranteed)
inst={r[5] for r in rows}
out={"completion_window_utc":[t0.isoformat()+"Z",t1.isoformat()+"Z"],"requests":len(rows),"instances":sorted(i for i in inst if i)}
def pct(v,q):
    v=sorted(v); 
    return v[min(len(v)-1,int(q*len(v)))] if v else None
bycls={}
for a,c,d,p,s,i,m in rows:
    bycls.setdefault(cls(p),[]).append(d)
st={}
for a,c,d,p,s_,i,m in rows:
    st.setdefault(cls(p),{}).setdefault(str(s_),0); st[cls(p)][str(s_)]+=1
out["status_by_class"]=st
out["client_closed_499"]=sum(1 for r in rows if r[4]==499)
out["duration_ms_by_class"]={k:{"n":len(v),"p50":pct(v,.5),"p90":pct(v,.9),"p95":pct(v,.95),"max":max(v),"over_10s":sum(x>10000 for x in v),"over_20s":sum(x>20000 for x in v)} for k,v in sorted(bycls.items())}
# per-minute arrivals (by arrival time) vs completions, and sampled in-flight depth
mins={}
for a,c,d,p,s,i,m in rows:
    mins.setdefault(c.replace(second=0,microsecond=0),{"completed":0,"arrived":0})["completed"]+=1
    if a>=t0: mins.setdefault(a.replace(second=0,microsecond=0),{"completed":0,"arrived":0})["arrived"]+=1
out["per_minute"]={k.strftime("%H:%M"):v for k,v in sorted(mins.items())}
# in-flight depth at 10 s ticks, counting only requests whose arrival AND completion are inside the window
ticks=[]; t=t0+timedelta(seconds=60)
while t< t1-timedelta(seconds=45):
    n=sum(1 for a,c,*_ in rows if a<=t<c)
    nd=sum(1 for a,c,d,p,*_ in rows if a<=t<c and cls(p) in ("watch_root","watch_page"))
    ticks.append((t.strftime("%H:%M:%S"),n,nd)); t+=timedelta(seconds=10)
out["in_flight_samples_every_10s"]=[{"t":x,"all":n,"html":nd} for x,n,nd in ticks]
out["note"]="Completion-window bias: requests still in flight at the window end are absent, so late in-flight samples undercount; samples exclude the last 45 s."
print(json.dumps(out,indent=1))
