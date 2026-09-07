export function inspectStream(text,http){
 const records=[];let fields=[];
 for(const line of text.replaceAll('\r\n','\n').replaceAll('\r','\n').split('\n')){
  if(line===''){if(fields.length)records.push(fields.join('\n'));fields=[];continue;}
  if(line==='data')fields.push('');
  else if(line.startsWith('data:')){let value=line.slice(5);if(value.startsWith(' '))value=value.slice(1);fields.push(value);}
 }
 // An unterminated event is incomplete, even if its data resembles DONE.
 const terminal=fields.length===0&&records.at(-1)==='[DONE]'&&records.filter(r=>r==='[DONE]').length===1;
 let events;
 try{events=records.filter(r=>r!=='[DONE]').map(r=>JSON.parse(r));if(events.some(e=>!e||typeof e!=='object'||Array.isArray(e)))throw new Error('Invalid event');}
 catch{return {http,completeStream:false,actualCostUSD:null,error:'Malformed stream'};}
 const models=[...new Set(events.map(e=>e.model).filter(Boolean))],providers=[...new Set(events.map(e=>e.provider).filter(Boolean))];
 const usage=events.findLast(e=>e.usage)?.usage??null;
 return {http,completeStream:http===200&&terminal&&!events.some(e=>e.error)&&events.some(e=>e.choices?.some(c=>['stop','length','tool_calls','content_filter','function_call'].includes(c.finish_reason))),model:models.length===1?models[0]:null,provider:providers.length===1?providers[0]:null,usage,actualCostUSD:typeof usage?.cost==='number'?usage.cost:null,requestIds:[...new Set(events.map(e=>e.id).filter(Boolean))]};
}
