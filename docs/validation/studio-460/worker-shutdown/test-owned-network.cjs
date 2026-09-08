const net = require('node:net');
const owned = new Set();
const listen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  this.once('listening', () => { const a = this.address(); if (a && typeof a === 'object') owned.add(a.port); });
  return listen.apply(this, args);
};
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let first = args[0]; if (Array.isArray(first)) first = first[0];
  const options = typeof first === 'object' ? first : { port: first, host: typeof args[1] === 'string' ? args[1] : 'localhost' };
  const host = options.host || options.hostname || 'localhost';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !owned.has(Number(options.port))) throw new Error('STUDIO460_TEST_ENDPOINT_DENIED');
  return connect.apply(this, args);
};
