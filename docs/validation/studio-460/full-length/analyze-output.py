import subprocess,array,math,json,os
codec='/tmp/forge-studio-460-runtime/codec/ffmpeg-n9.0-latest-linux64-gpl-9.0/bin/ffmpeg'
source='/tmp/forge-studio-460-runtime/full-length-output.mp4'
result=[]
for start in [0.1,115,230]:
 data=subprocess.check_output([codec,'-v','error','-nostdin','-ss',str(start),'-i',source,'-t','1','-map','0:a:0','-ac','1','-ar','48000','-f','f32le','pipe:1'],timeout=15,env={'PATH':'/usr/bin:/bin'})
 samples=array.array('f',data);rms=math.sqrt(sum(v*v for v in samples)/len(samples));frequency=sum(1 for a,b in zip(samples,samples[1:]) if a<=0<b)*48000/len(samples)
 assert 0.03<rms<0.06,(start,rms)
 assert 870<frequency<890,(start,frequency)
 result.append({'startSeconds':start,'sampleCount':len(samples),'rms':rms,'frequencyHz':frequency,'expectedGain':0.5})
subprocess.run([codec,'-v','error','-nostdin','-ss','115','-i',source,'-frames:v','1','-y','/home/tataihono/.cache/forge-studio-460-runtime/full-frame115.png'],check=True,timeout=15,env={'PATH':'/usr/bin:/bin'})
print(json.dumps(result))
