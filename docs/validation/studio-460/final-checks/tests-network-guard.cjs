require('/home/tataihono/.cache/forge-studio-460-runtime/browser/local-provider-only.cjs');
const net=require('node:net');
const connect=net.Socket.prototype.connect,listen=net.Server.prototype.listen;
const fixed=new Set([55460,34666,34667,34668,34669,34670,34671,34672,34674,34680,34681]);
const listeners=new Set();
const local=host=>['127.0.0.1','localhost','studio460.localhost','::1','[::1]'].includes(host);
const ownedPath=path=>['/tmp/forge-studio-460-runtime/','/home/tataihono/.cache/forge-studio-460-runtime/'].some(root=>path.startsWith(root));
net.Server.prototype.listen=function(...args){
 this.once('listening',()=>{const address=this.address();if(address&&typeof address==='object'){listeners.add(address.port);this.once('close',()=>listeners.delete(address.port));}});
 return listen.apply(this,args);
};
class TaskEndpointDenied extends Error{constructor(){super('Task test guard denies non-owned endpoint');this.code='TASK_ENDPOINT_DENIED';}}
net.Socket.prototype.connect=function(...args){
 const [options]=Array.isArray(args[0])?args[0]:net._normalizeArgs(args);
 const allowed=typeof options.path==='string'?ownedPath(options.path):local(options.host??options.hostname??'localhost')&&(fixed.has(Number(options.port))||listeners.has(Number(options.port)));
 if(!allowed)throw new TaskEndpointDenied();
 return connect.apply(this,args);
};
require('node:module').syncBuiltinESMExports();
// No UDP service belongs to this task; telemetry must not contact a local agent.
const dgram=require('node:dgram');
dgram.Socket.prototype.send=function(){throw new TaskEndpointDenied();};
require('node:module').syncBuiltinESMExports();
