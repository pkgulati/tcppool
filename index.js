var net = require('net');
var SocketPool = require('./pool');
var async = require('async');

var server = net.createServer();
server.on('connection', handleConnection);

var max_requests_count = 100;
var required_tps = 7;

var pool = new SocketPool({maxConnections:6,maxQueueLength:50});

// 0 
function handleConnection(conn) {
    var remoteAddress = conn.remoteAddress + ':' + conn.remotePort;
   // console.log('new client connection from %s', remoteAddress);
    conn.setEncoding('utf8');
    conn.on('data', onConnData);
    conn.once('close', onConnClose);
    conn.on('error', onConnError);
    function onConnData(d) {
        //console.log('connection data from %s: %j', remoteAddress, d);
        var t = Math.random() * 5100;  
        setTimeout(()=> {
            conn.write(d.toUpperCase());
        }, t+100);
    }
    function onConnClose() {
        console.log('connection from %s closed', remoteAddress);
    }
    function onConnError(err) {
        console.log('Connection %s error: %s', remoteAddress, err.message);
    }
}

server.listen(8080, function () {
    console.log('server listening to %j', server.address());
    pool.openIdleConnections(2);
});


var num_processed = 0;
var num_sent = 0;


function sendRequest() {
    var request = 'ab-' + (num_sent + 1);
    var reqstart = Date.now();
    pool.getClient(function (err, client) {
        if (err) {
            console.log('ERROR pool client ', request, ' Erorr ', err.code);
            num_processed++;
            return;
        }
        console.log('sending ', request);
        client.sendRequest(request, function (err, data) {
            num_processed++;
            if (err) {
                console.log('error occured in ', request);
                if (err.code == 'ERROR_REQUEST_TIME_OUT') {
                    console.log('request timed out');
                }
            }
            else  {
                var reqend = Date.now();
                console.log('request response time including pool wait ', reqend-reqstart);
                console.log('received response ' + data.toString());
            }
            client.release();
        });
    });
    num_sent++;
}

var start = Date.now();
var timer = setInterval(function() {
    //console.log(num_sent);
    if (num_sent < max_requests_count) {
        sendRequest();
    } else if (num_processed < max_requests_count) {
        console.log('responses received ', num_processed);
        pool.processQueue();
    }
    else {
        console.log('all response received ');
        console.log('pool info total clients ', pool.clientsCount);
        var now = Date.now();
        var elapsed_ms = now - start;
        var elapsed_secs = (elapsed_ms / 1000);
        var current_tps = num_sent / elapsed_secs;
        console.log('current tps ', current_tps);
        console.log('rt in ms all connections ', 1000 / current_tps);
        console.log('rt in ms per connection ', pool.clientsCount * 1000 / current_tps);
        console.log('elapsed time secs ', elapsed_secs);
        console.log('elapsed time ms ', elapsed_ms);
        clearInterval(timer);    
    }
}, 22);



