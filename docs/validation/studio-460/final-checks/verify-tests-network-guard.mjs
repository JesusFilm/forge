import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
const udp=dgram.createSocket('udp4');assert.throws(()=>udp.send(Buffer.from('denied'),8125,'127.0.0.1'),{code:'TASK_ENDPOINT_DENIED'});udp.close();
for(const options of [{host:'127.0.0.1',port:6379},{host:'localhost',port:5432},{host:'localhost',port:80},{host:'192.0.2.1',port:55460},{path:'/tmp/unowned-studio-test.sock'}]){
 assert.throws(()=>net.connect(options),{code:'TASK_ENDPOINT_DENIED'});
}
const server=net.createServer(socket=>socket.end('owned'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const value=await new Promise((resolve,reject)=>{let result='';const socket=net.connect({host:'127.0.0.1',port});socket.on('data',chunk=>result+=chunk);socket.on('end',()=>resolve(result));socket.on('error',reject)});
assert.equal(value,'owned');
await new Promise(resolve=>server.close(resolve));
assert.throws(()=>net.connect({host:'127.0.0.1',port}),{code:'TASK_ENDPOINT_DENIED'});
console.log('PASS: default DB, unowned local TCP, external TCP and unowned Unix denied; same-process owned listener allowed only during lifetime.');
