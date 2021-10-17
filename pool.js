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
		this.pool = options.pool;
		this.requestTimeout = options.requestTimeout || 3000;
		this.idleTimeout = options.idleTimeout || 3000;
		this.maxRequestsPerConnection = options.maxRequestsPerConnection || 1000;
		this.requestsCount = 0;
	}

	connect(cb) {
		var self = this;
		var connectErrorHandler = function (err) {
			console.log('Connection Error');
			cb(err)
		};
		self.socket.once('error', connectErrorHandler);
		self.socket.connect(this.port, this.host, function () {
			self.socket.removeListener('error', connectErrorHandler);
			if (self.idleTimeout) {
				self.idleTimer = setTimeout(function () {
					console.log('idle time out happend');
					self.disconnect();
				}, self.idleTimeout);
			}
			self.connected = true;
			cb(null, self);
		});
	}

	sendRequest(buf, receiver) {
		// reconnect
		var self = this;
		this.requestsCount++;
		if (!self.socket || !self.connected) {
			console.log('client id ', client.id);
			var err = new Error('sendRequest on closed socket');
			err.code = 'ERROR_SEND_ON_CLOSE_SOCKET';
			return receiver(err);
		}
		self.socket.removeAllListeners('data');
		self.socket.removeAllListeners('error');
		self.socket.on('data', function (data) {
			if (self.requestTimer) {
				clearTimeout(self.requestTimer);
			}
			self.requestTimer = null;
			if (self.idleTimeout) {
				self.idleTimer = setTimeout(function () {
					self.disconnect();
				}, self.idleTimeout);
			}
			receiver(null, data);
		});
		self.socket.on('error', function (err) {
			console.log('error on socket ', err.Code);
			if (self.requestTimer) {
				clearTimeout(requestTimer);
				self.requestTimer = null;
			}
			if (self.idleTimer) {
				clearTimeout(self.idleTimer);
				self.idleTimer = null;
			}
			self.disconnect();
		});
		if (self.idleTimer) {
			clearTimeout(self.idleTimer);
			self.idleTimer = null;
		}
		this.socket.write(buf);
		if (self.requestTimeout) {
			self.requestTimer = setTimeout(function () {
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
		if (self.idleTimer) {
			clearTimeout(self.idleTimer);
		}
		if (self.requestTimer) {
			clearTimeout(self.requestTimer);
		}
		if (self.connected && self.socket) {
			self.socket.destroy();
		}
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
		this.requestTimeout = options.requestTimeout || 3000;
		this.idleTimeout = options.idleTimeout || 3000;
		this.maxRequestsPerConnection = options.maxRequestsPerConnection || 1000;
		this.pool = this;
	}

	processQueue() {
		var self = this;
		if (self.queue.length > 0 && (self.clientsCount < self.maxConnections)) {
			setImmediate(function(){
				self.openIdleConnections(1);
			})
		}
		//console.log('queue length', self.queue.length);
		while (self.queue.length > 0 && self.freeList.length > 0) {
			//console.log('give from queue');
			var cb = self.queue.shift();
			var client = self.freeList.shift();
			if (client.connected) {
				if (client.idleTimer) {
					clearTimeout(client.idleTimer);
					client.idleTimer = null;
				}
				process.nextTick(function () {
					client.busy = true;
					cb(null, client);
				});
			}
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
		while (self.freeList.length) {
			var client = self.freeList.shift();
			if (client.connected) {
				if (client.idleTimer) {
					clearTimeout(client.idleTimer);
					client.idleTimer = null;
				}
				process.nextTick(function () {
					client.busy = true;
					cb(null, client);
				});
				return;
			}
		}

		if (self.clientsCount < self.maxConnections) {
			// New Client 
			var client = new Client(self);
			self.clientsCount++;
			console.log('clientsCount up ', self.clientsCount, client.id);
			self.clients[client.id] = client;
			client.connect(function (err, me) {
				if (err) {
					self.clientsCount--;
					delete self.clients[client.id];
					console.log('clientsCount down on error ', self.clientsCount, client.id);
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
					if (client.idleTimer) {
						clearTimeout(client.idleTimer);
						client.idleTimer = null;
					}
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
		if (client && !client.connected) {
			self.clientsCount--;
			client.pool = null;
			console.log('clientsCount down on release and disconnect ', self.clientsCount, client.id);
			delete self.clients[client.id];
			client = null;
		}

		if (client && client.connected) {
			if (client.requestsCount >= client.maxRequestsPerConnection) {
				console.log('close connection as maxRequestsPerConnection reached ', client.id);
				client.pool = null;
				client.requestsCount = 0;
				client.disconnect();
				self.clientsCount--;
				console.log('clientsCount down on release and maxRequests reached ', self.clientsCount, client.id);
				if (client.idleTimer) {
					clearTimeout(client.idleTimer);
					client.idleTimer = null;
				}
				delete self.clients[client.id];
			}
			else {
				if (client.idleTimer) {
					clearTimeout(client.idleTimer);
					client.idleTimer = null;
				}
				if (client.idleTimeout) {
					client.idleTimer = setTimeout(function () {
						console.log('idle time happened');
						client.disconnect();
					}, client.idleTimeout);
				}
				client.busy = false;
				self.freeList.push(client);
				// till next send
				client.socket.on('error', function () {
					console.log('Error in socket of client ', client.id);
					self.socket.removeAllListeners('error');
					client.disconnect();
					self.release(client);
				});
			}
		}
		if (self.queue.length > 0) {
			//console.log('process q on release');
			setImmediate(function () {
				self.processQueue();
			})
		}
	}
}

module.exports = Pool;

