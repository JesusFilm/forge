import './publication-fetch.mjs';
import net from 'node:net';
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const values=Array.isArray(args[0])?args[0]:args,options=values[0],port=typeof options==='object'?Number(options.port):Number(options);if([6379,5432].includes(port)){queueMicrotask(()=>this.destroy(new Error('Owned unit harness denies shared default service ports')));return this}return original.apply(this,args)};
