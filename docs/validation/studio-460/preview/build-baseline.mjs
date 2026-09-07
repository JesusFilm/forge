import {build} from '/home/tataihono/.codex/worktrees/06c1/forge/apps/studio-preview/node_modules/esbuild/lib/main.js'
import {readFile} from 'node:fs/promises'
const root='/home/tataihono/.codex/worktrees/06c1/forge/apps/studio-preview'
const destination='/tmp/forge-studio-460-runtime/preview-baseline'
const original=await readFile(destination+'/src/client.tsx','utf8')
await build({absWorkingDir:root,entryPoints:['src/client.tsx'],bundle:true,outfile:destination+'/dist/client.js',platform:'browser',format:'iife',minify:true,define:{'process.env.NODE_ENV':'"production"'},target:'es2022',plugins:[{name:'fixed-base-client',setup(builder){builder.onLoad({filter:/\/apps\/studio-preview\/src\/client\.tsx$/},()=>({contents:original,loader:'tsx',resolveDir:root+'/src'}))}}]})
