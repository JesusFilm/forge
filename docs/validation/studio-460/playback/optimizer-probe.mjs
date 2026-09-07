import {createHash} from 'node:crypto';
const origin='http://127.0.0.1:42860';
for(const path of ['/api/studio/playback/release/poster.webp','/api/studio/playback/release/poster.webp/','/%61pi/studio/playback/release/poster.webp','/api/%73tudio/playback/release/poster.webp','/redirect','/core.png']){
 const direct=await fetch(origin+path,{redirect:'manual'});await direct.arrayBuffer();
 const target=new URL('/_next/image',origin);target.searchParams.set('url',origin+path);target.searchParams.set('w','640');target.searchParams.set('q','75');
 const attempts=[];
 for(let i=0;i<2;i++){
  const response=await fetch(target);const bytes=Buffer.from(await response.arrayBuffer());attempts.push({status:response.status,cache:response.headers.get('cache-control'),nextCache:response.headers.get('x-nextjs-cache'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 console.log(JSON.stringify({path,direct:direct.status,location:direct.headers.get('location'),attempts}));
}
