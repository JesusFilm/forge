"""Light-leak flashes for vertical intros (owner rules 2026-10-16).

Usage: python3 intro-light-leaks.py <in.mp4> <out.mp4> <cut1,cut2,...>
The film's punch zoom is NOT done here (render with --intro-punch: film only,
captions still). This adds: an opening flash at 0.15 s, then one flash per
line cut, each different in colour/direction/length, and the SHAPE alternates
full frame -> right-hand rectangle -> full frame ... (owner: "once the whole
screen, then only a rectangle on the right, then the whole again").
"""
import subprocess, sys
V, OUT = sys.argv[1], sys.argv[2]
cuts = [float(x) for x in sys.argv[3].split(",")]
dur = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",V],capture_output=True,text=True).stdout)
LOOKS = [
 "type=radial:x0=1080:y0=0:x1=200:y1=1500:c0=0xffd27a:c1=0xff6a00:c2=0xd81e00:nb_colors=3:speed=0.02",
 "type=linear:x0=0:y0=900:x1=1080:y1=1000:c0=0xff1e3c:c1=0xff7a1a:c2=0xffe0a0:c3=0xff2a00:nb_colors=4:speed=0.09",
 "type=radial:x0=540:y0=1920:x1=540:y1=200:c0=0xfff1c8:c1=0xffb347:c2=0xff5a00:nb_colors=3:speed=0.03",
 "type=circular:x0=0:y0=700:x1=1080:y1=1300:c0=0xc81400:c1=0xff6a00:c2=0xffc070:nb_colors=3:speed=0.05",
]
# (time, rise, fall, double flicker, shape) ; shape: full | right
events = [(0.15, 0.05, 0.45, False, "full")]
for i, c in enumerate(cuts):
    shape = "right" if i % 2 == 0 else "full"
    rise, fall = [(0.10, 0.30), (0.06, 0.20), (0.14, 0.42), (0.12, 0.50)][i % 4]
    events.append((c, rise, fall, i % 4 == 1, shape))
# soft right-hand rectangle: x from 52% to the edge, y 12%..78%, 60px feather
RIGHT = "(clip((X-W*0.52)/60,0,1)*clip((Y-H*0.12)/60,0,1)*clip((H*0.78-Y)/60,0,1))"
def env(c, r, f, dbl):
    e = f"if(lt(T,{c}),max(0,1-({c}-T)/{r}),max(0,1-(T-{c})/{f}))"
    if dbl:
        c2 = c + 0.22
        e = f"max({e},0.8*if(lt(T,{c2}),max(0,1-({c2}-T)/0.05),max(0,1-(T-{c2})/0.16)))"
    return e
inputs = ["-i", V]; fc = ["[0:v]format=gbrp[v0]"]; cur = "v0"
for i, (c, r, f, dbl, shape) in enumerate(events):
    look = LOOKS[i % len(LOOKS)]
    inputs += ["-f", "lavfi", "-i", f"gradients=s=1080x1920:r=30:d={dur}:{look},gblur=sigma=50,format=gbrp"]
    E = f"min(1,{env(c, r, f, dbl)})" + (f"*{RIGHT}" if shape == "right" else "")
    scr = f"(255-(255-A)*(1-B*{E}/255))"
    bloom = 0.5 if shape == "full" else 0.3
    fc.append(f"[{i+1}:v]format=gbrp[g{i}];[{cur}][g{i}]blend=all_expr='{scr}+(255-{scr})*pow({E},3)*{bloom}'[v{i+1}]")
    cur = f"v{i+1}"
fc.append(f"[{cur}]format=yuv420p[vout]")
subprocess.run(["ffmpeg","-v","error","-y",*inputs,"-filter_complex",";".join(fc),"-map","[vout]","-map","0:a","-c:v","libx264","-crf","17","-preset","medium","-c:a","copy","-t",str(dur),OUT], check=True)
print("ok")
