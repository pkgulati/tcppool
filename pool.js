var net = require('net');
var uuid = require('uuid');

class Client {

	constructor(options) {
		options = options || {};
		this.host = options.host || 'localhost';
		this.port = options.port || 8080;
		this.socket = new net.Socket();
		this.id = uuid.v4();
		this.connected = false;
		this.connectCallback = null;
		this.pool = options.pool;
		this.requestTimeout = options.requestTimeout ||  3000;
	}

	connect(cb) {
		var self = this;
		var connectErrorHandler = function (err) {
			console.log('Connection Error');
			cb(err)
		};
		self.socket.once('error', connectErrorHandler);
		self.socket.connect(this.port, this.host, function () {
			self.connected = true;
			self.socket.removeListener('error', connectErrorHandler);
			cb(null, self);
		});
	}

	sendRequest(buf, receiver) {
		// reconnect
		var self = this;
		var requestTimer = null;
		self.socket.removeAllListeners('data');
		self.socket.removeAllListeners('error');
		self.socket.on('data', function (data) {
			if (requestTimer) {
				clearTimeout(requestTimer);
			}
			receiver(null, data);
		});
		self.socket.on('error', function (err) {
			console.log('error on socket ', err.Code);
			self.disconnect();
		});
		this.socket.write(buf);
		if (self.requestTimeout) {
			requestTimer = setTimeout(function(){
				console.log('request timed out');
				var err = new Error('Request Timeout occured');
				err.code = 'ERROR_REQUEST_TIME_OUT';
				self.disconnect();
				receiver(err, null);
			}, self.requestTimeout);
		}
	}

	// setListner(eventName, listener) {
	// 	var self = this;
	// 	this.socket.setListner(eventName, function (evt) {
	// 		var event = {
	// 			name : eventName,
	// 			client: self,
	// 			event: evt
	// 		}
	// 		listener(event);
	// 	});
	// }

	disconnect() {
		var self = this;
		self.socket.destroy();
		self.connected = false;
		self.socket = null;
		if (self.pool) {
			self.pool.release(self);
		}
	}

	release() {
		if (this.pool) {
			this.pool.release(this);
		}
	}
}

var pq = 0;

class Pool {

	constructor(options) {
		options = options || {};
		this.maxConnections = options.maxConnections || Infinity;
		this.host = options.host || 'localhost';
		this.port = options.port || 8080;
		this.freeList = [];
		this.clients = {};
		this.clientsCount = 0;
		this.map = {};
		this.queue = [];
		this.maxQueueLength = options.maxQueueLength || 20;
		

	}

	processQueue() {
		var self = this;
		//console.log('queue length', self.queue.length);
		while (self.queue.length > 0 && self.freeList.length > 0) {
			//console.log('give from queue');
			var cb = self.queue.shift();
			console.log('popped from queue');
			var client = self.freeList.shift();
			process.nextTick(function () {
				client.busy = true;
				cb(null, client);
			});
		}
	}


	openIdleConnections(n) {
		var self = this;
		for (var i = 0; i < n; i++) {
			self.getClient(function (err, client) {
				if (client) {
					client.release();
				}
			});
		}
		if (self.queue.length > 0) {
			setImmediate(function () {
				self.processQueue();
			})
		}
	};

	getClient(cb) {
		var self = this;
		if (self.freeList.length) {
			var client = self.freeList.shift();
			process.nextTick(function () {
				client.busy = true;
				cb(null, client);
			});
		} else if (self.clientsCount < self.maxConnections) {
			var client = new Client({
				host: self.host,
				port: self.port,
				pool: self,
			});
			self.clientsCount++;
			self.clients[client.id] = client;
			client.connect(function (err, me) {
				if (err) {
					self.clientsCount--;
					delete self.clients[client.id];
					cb(err, null);
				}
				else {
					console.log('client connected ', client.id);
					// till first request
					client.socket.on('error', function () {
						console.log('Error in socket of client ', client.id);
						self.socket.removeAllListeners('error');
						client.disconnect();
						self.release(client);
					});
					process.nextTick(function () {
						client.busy = true;
						cb(null, client);
					});
				}
			});
		} else if (self.queue.length < self.maxQueueLength) {
			console.log('pushed to queue ', typeof cb);
			self.queue.push(cb);
			setImmediate(function () {
				self.processQueue();
			});
		} else {
			var err = new Error('Maximum Limit of connections and queue reached');
			err.code = 'ERROR_CONNECTIONS_LIMIT_REACHED';
			cb(err);
		}
	}

	release(releaseClient) {
		console.log('release client ', releaseClient.id);
		var self = this;
		if (!releaseClient.id) {
			return
		}
		var client = self.clients[releaseClient.id];
		if (client) {
			if (client.connected) {
				client.busy = false;
				self.freeList.push(client);
				// till next send
				client.socket.on('error', function () {
					console.log('Error in socket of client ', client.id);
					self.socket.removeAllListeners('error');
					client.disconnect();
					self.release(client);
				});
				if (self.queue.length > 0) {
					//console.log('process q on release');
					setImmediate(function () {
						self.processQueue();
					})
				}
			} else {
				delete self.clients[client.id];
				self.clientsCount--;
			}
		}
		if (self.queue.length > 0 && (self.clientsCount < self.maxConnections)) {
			self.openIdleConnections(1);
		}
	}
}

module.exports = Pool;

