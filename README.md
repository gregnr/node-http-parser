#Node HTTP Parser
#### *node-http-parser*
Node HTTP Parser is the JavaScript implementation of an HTTP parser.

### Goal
The goal of this library is to provide an HTTP/1.1 compliant parser written in JavaScript. It can parse both requests and responses. Some important features it supports:

- Chunked response parsing
- Automatic gzip decompression
- HTTP pipelining (effectively can take a infinite stream of data chunks and continually parse requests/responses as they come)


### Current Stage
This project is pretty new. It currently does support chunked response parsing, gzip decompression, and HTTP pipelining, however it has not been tested thoroughly. The current priority is to begin writing test cases over a diverse range of input.

### Usage
Node HTTP Parser takes a stream of data chunks as input. This is useful for most applications, which collect chunks of HTTP data as new packets arrive.

Here is an example on how to use it to parse HTTP requests from a socket server:

    var net = require('net');
    var HTTPParser = require("./node-http-parser/http-parser");
    
    var requestParser = new HTTPParser.RequestParser();
    requestParser.on("parseComplete", function(httpObject) {
    
        console.log("Request parse complete");
        console.log("Request headers: " + httpObject.headers);
        console.log("Request body: " + httpObject.body.toString());
        console.log();
        
    });
    
    net.createServer(function(socket) {

        socket.on('data', function(chunk) {
            requestParser.pushChunk(chunk);
        });
        
    }).listen(80);

### Events
Node HTTP Parser calls the "parseComplete" event each time it finishes parsing a request/response. Below are all of the events supported:

**parseComplete:**

Returns:
- httpObject:
    - headers: (Object) - Key-value string pairs for each header
    - body: (Buffer) - The HTTP body. Returned as binary buffer since it could have any content type
    - rawHeaders: (Array) - List of two-element arrays containing all header keys and values, *including duplicate keys*
    - rawBody: (Buffer) - Raw compressed body. Will only exist if the body was originally gzipped.

Example:

    requestParser.on("parseComplete", function(httpObject) {
    
        console.log("Request parse complete");
        console.log("Request headers: " + httpObject.headers);
        console.log("Request body: " + httpObject.body.toString());
        console.log();
        
    });
    
    
**headersLoaded:**

Returns:
- headers: (Object) - Key-value string pairs for each header

Example:

    requestParser.on("headersLoaded", function(headers) {
    
        console.log("Headers loaded");
        console.log("Request headers: " + headers);
        console.log();
        
    });
    
**bodyLoaded:**

Returns:
- body: (Buffer) - The HTTP body. Returned as binary buffer since it could have any content type

Example:

    requestParser.on("bodyLoaded", function(body) {
    
        console.log("Headers loaded");
        console.log("Request body: " + httpObject.body.toString());
        console.log();
      
    });
