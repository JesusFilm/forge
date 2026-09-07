import {mkdtemp,writeFile,readFile,copyFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {executeStudioChild} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/studio-render/src/isolation.mjs'
import {currentCgroupDirectory,verifyExecutionBudget} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/studio-render/src/budget.mjs'
const root='/home/tataihono/.codex/worktrees/06c1/forge',dir=await mkdtemp('/home/tataihono/.cache/forge-studio-460-runtime/verify-full-')
try{
 const output=await readFile('/tmp/forge-studio-460-runtime/full-length-output.mp4'),digest=createHash('sha256').update(output).digest('hex'),cgroup=await currentCgroupDirectory()
 await writeFile(join(dir,'input.json'),JSON.stringify({digest,width:1080,height:1920,fps:30,durationInFrames:6930}))
 await writeFile(join(dir,'output.mp4'),output)
 const started=performance.now()
 const proof=await executeStudioChild({nativeDir:join(root,'apps/studio-render/dist'),child:join(root,'apps/studio-render/src/verify.mjs'),node:process.execPath,input:dir,codec:'/tmp/forge-studio-460-runtime/codec/ffmpeg-n9.0-latest-linux64-gpl-9.0/bin',timeoutMs:60000,stdoutBytes:8192})
 await writeFile('/home/tataihono/.cache/forge-studio-460-runtime/full-length-codec-proof.json',proof)
 console.log(JSON.stringify({budget:await verifyExecutionBudget(cgroup),elapsedMs:performance.now()-started,outputBytes:output.length,proof:JSON.parse(proof),memoryPeak:await readFile(join(cgroup,'memory.peak'),'utf8'),cpu:await readFile(join(cgroup,'cpu.stat'),'utf8')}))
}finally{await rm(dir,{recursive:true,force:true})}
