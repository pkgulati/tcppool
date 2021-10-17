# TCP Socket Pool

A TCP Socket Pool which supports following feature.

* Maximum Number of Connections
* Idle Time out 
* Maximum Number of Requests per Connection
* A temporary in memory Queue to handle temporary load increase
* Automatic reconnect on connection errors
* Open Idle Connections in advance

## Usage

Get client connection using pool.getClient, and then send data using sendRequest.
Callback for sendRequest is called multiple times if data is received in chunks. 
Once client.release is called, receive callback is not called, and connection is put back in pool. 
One must consume full response, before releasing the client, as socket pool does not know where response ends.

```js
 pool.getClient(function (err, client) {
        if (err) {
            console.log('ERROR pool client ', request, ' Erorr ', err.code);
            return;
        }
        var isResponseComplete = false;
        client.sendRequest(request, function (err, data) {
            if (err) {
                console.log('error occured in ', request);
                client.release();
            }
            else {
                // buffer it
                console.log('received response ' + data.toString());
                // once response is complete, set isResponseComplete true
                isResponseComplete = true;
                if (isResponseComplete) {
                    client.release();
                }
        });
    });
```


## Configuration
|Parameter|Default Value|Remarks|
|------|-----|-----|
|maxConnections|Infinity|Maximum Number of connections|
|maxQueueLength|20|Maximum Queue Length|
|requestTimeout|3000| Request Time out in mili seconds, If server does not respond with in this time, connection is closed, and request fails|
|idleTimeout|36000|Idle time out in mili seconds, Connection is closed, if there is no activity on socket |
|maxRequestsPerConnection|1000|Connection is closed after every 1000 requests|

For opening x number idle connections, in start up, following method can be invoked
```js
pool.openIdleConnections(x)
```

















