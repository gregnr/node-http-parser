var events = require("events");
var zlib = require("zlib");

var State = {
    GET_FIRST_LINE: 1,
    GET_HEADERS: 2,
    GET_BODY: 3,
    PARSE_COMPLETE : 4
};

//Get the index of a string within a buffer
var bufferIndexOf = function(buffer, searchString) {

    //Loop through each byte in the buffer
    for (var i = 0; i < buffer.length; i++) {
        
        var stringMatch = true;
        
        //Check if the current and consecutive bytes match the search string
        for (var j = 0; j < searchString.length; j++) {
            
            var charCode = searchString.charCodeAt(j);
            
            if (buffer[i + j] != charCode) {
                
                stringMatch = false;
                break;
            }
        }
        
        if (stringMatch) return i;
    }
    
    return -1;
};

var RequestParser = function() {

    //Init:

    //Call the EventEmitter constructor
    events.EventEmitter.call(this);
    
    var that = this;
    
    
    //Private variables:
    
    //HTTP object that we will build
    var httpObject = {
        headers: []
    };
    
    //The start state will be looking for the first line
    var state = State.GET_FIRST_LINE;
    
    //Buffer to store incoming data chunks
    var binaryBuffer = new Buffer(0);
    
    //Private functions:
    
    var getFirstLine = function() {
        
        var firstLineEnd = bufferIndexOf(binaryBuffer, "\r\n");
        
        //Return if we do not have a complete first line
        if (firstLineEnd === -1) return false;
        
        var firstLine = binaryBuffer.toString("utf8", 0, firstLineEnd);
        
        //Get HTTP Method, URL, and version from first line
        var httpRegex = /(.+) (.+) HTTP\/(.+)/;
        var httpMatch = firstLine.match(httpRegex);
        
        //Return if we do not have a match
        if (!httpMatch) return false;
        
        httpObject.method = httpMatch[1];
        httpObject.url = httpMatch[2];
        httpObject.version = httpMatch[3];
        
        //Remove the data we parsed from the buffer
        binaryBuffer = binaryBuffer.slice(firstLineEnd + Buffer.byteLength("\r\n"));
        
        return true;
    };
    
    var getHeaders = function() {
        
        var headerEnd = bufferIndexOf(binaryBuffer, "\r\n\r\n");
        
        //Return if we do not have a complete header
        if (headerEnd === -1) return false;
    
        //rawHeader includes everything up until the headerEnd
        var rawHeader = binaryBuffer.toString("utf8", 0, headerEnd);
        
        var headerEntries = rawHeader.split("\r\n");
        
        for (var i = 0; i < headerEntries.length; i++) {
            
            var headerEntry = headerEntries[i].toLowerCase();
            var headerKeyValue = headerEntry.split(": ");
            
            if (headerKeyValue.length > 1) {
                
                //Get content length if it's set
                if (headerKeyValue[0] === "content-length") {
                    httpObject.contentLength = headerKeyValue[1];
                }
                
                httpObject.headers.push(headerKeyValue);
            }
        }
        
        //Remove the data we parsed from the buffer
        binaryBuffer = binaryBuffer.slice(headerEnd + Buffer.byteLength("\r\n\r\n"));
        
        return true;
    };
    
    var getBody = function() {
    
        if (httpObject.contentLength && httpObject.contentLength > 0) {
            
            var contentLength = parseInt(httpObject.contentLength);
            
            //Return if we do not have a complete body
            if (binaryBuffer.length < contentLength) return false;
            
            //Create a new buffer to store the body
            var body = new Buffer(contentLength);
            binaryBuffer.copy(body);
            
            httpObject.body = body;
            
            //Remove the data we parsed from the buffer
            binaryBuffer = binaryBuffer.slice(contentLength + Buffer.byteLength("\r\n"));
            
            return true;
            
        } else {
        
            //The HTTP response has no body
            //We may need to strip off some newlines from the buffer...?
            httpObject.body = new Buffer(0);
            
            return true;
        }
    };
    
    var executeState = function() {
    
        switch (state) {
        
            case State.GET_FIRST_LINE:
                
                if (getFirstLine()) {
                
                    state = State.GET_HEADERS;
                    executeState();
                }
                break;
                
            case State.GET_HEADERS:
            
                if (getHeaders()) {
        
                    that.emit("headersLoaded", httpObject.headers);
                    
                    state = State.GET_BODY;
                    executeState();
                }
                break;
                
            case State.GET_BODY:
            
                if (getBody()) {
                    
                    that.emit("bodyLoaded", httpObject.body);
                    that.emit("parseComplete", httpObject);
                    
                    state = State.GET_FIRST_LINE;
                    
                    //Create a new httpObject for the next pipelined request
                    httpObject = {
                        headers: []
                    };
                    
                    executeState();
                }
                break;
        }
        
        //console.log("Request State:", state);
    };
    
    
    //Public functions:
    
    this.pushChunk = function(chunk) {
        
        //TODO: Make this more memory efficient (don't create a new buffer every time a chunk comes in)
        binaryBuffer = Buffer.concat([binaryBuffer, chunk]);
        
        executeState();
    };
};

var ResponseParser = function() {

    //Init:

    //Call the EventEmitter constructor
    events.EventEmitter.call(this);
    
    var that = this;
    
    
    //Private variables:
    
    //HTTP object that we will build
    var httpObject = {
        headers: []
    };
    
    //The start state will be looking for the first line
    var state = State.GET_FIRST_LINE;
    
    //Buffer to store incoming data chunks
    var binaryBuffer = new Buffer(0);
    
    //Buffer used when parsing responses with a chunked transfer-encoding
    var binaryChunkBuffer = new Buffer(0);
    
    
    //Private functions:
    
    var getFirstLine = function() {
        
        var firstLineEnd = bufferIndexOf(binaryBuffer, "\r\n");
        
        //Return if we do not have a complete first line
        if (firstLineEnd === -1) return false;
        
        var firstLine = binaryBuffer.toString("utf8", 0, firstLineEnd);
        
        //Get HTTP version and status code from first line
        var httpRegex = /HTTP\/(.+) (\d+) (.+)/;
        var httpMatch = firstLine.match(httpRegex);
        
        //Return if we do not have a match
        if (!httpMatch) return false;
        
        httpObject.version = httpMatch[1];
        httpObject.statusCode = httpMatch[2];
        
        //Remove the data we parsed from the buffer
        binaryBuffer = binaryBuffer.slice(firstLineEnd + Buffer.byteLength("\r\n"));
        
        return true;
    };
    
    var getHeaders = function() {
        
        var headerEnd = bufferIndexOf(binaryBuffer, "\r\n\r\n");
        
        //Return if we do not have a complete header
        if (headerEnd === -1) return false;
    
        //rawHeader includes everything up until the headerEnd
        var rawHeader = binaryBuffer.toString("utf8", 0, headerEnd);
        
        var headerEntries = rawHeader.split("\r\n");
        
        for (var i = 0; i < headerEntries.length; i++) {
            
            var headerEntry = headerEntries[i].toLowerCase();
            var headerKeyValue = headerEntry.split(": ");
            
            if (headerKeyValue.length > 1) {
                
                //Get content length if it's set
                if (headerKeyValue[0] === "content-length") {
                    httpObject.contentLength = headerKeyValue[1];
                }
                
                //Get transfer encoding if it's set
                if (headerKeyValue[0] === "transfer-encoding") {
                    httpObject.transferEncoding = headerKeyValue[1];
                }
                
                //Get content encoding if it's set
                if (headerKeyValue[0] === "content-encoding") {
                    httpObject.contentEncoding = headerKeyValue[1];
                }
                
                httpObject.headers.push(headerKeyValue);
            }
        }
        
        //Remove the data we parsed from the buffer
        binaryBuffer = binaryBuffer.slice(headerEnd + Buffer.byteLength("\r\n\r\n"));
        
        return true;
    };
    
    var getBody = function() {
        
        if (httpObject.transferEncoding && httpObject.transferEncoding === "chunked") {
            
            var firstLineEnd = bufferIndexOf(binaryBuffer, "\r\n");
            
            //Return if we do not have a complete first line
            if (firstLineEnd === -1) return false;
            
            //The first line of the body indicates the chunk length as a hexidecimal in bytes
            var chunkLength = parseInt(binaryBuffer.toString("ascii", 0, firstLineEnd), 16);
            
            //Return if we do not have a valid chunk length (throw error?)
            if (isNaN(chunkLength)) return false;
            
            if (chunkLength === 0) {
            
                //TODO: Remove folling newlines in case of pipelined HTTP
                
                httpObject.body = binaryChunkBuffer;
                return true;
            }
            
            //Return if we do not have a complete chunk
            if (binaryBuffer.length < chunkLength) return false;
            
            //Remove the data we parsed from the buffer
            binaryBuffer = binaryBuffer.slice(firstLineEnd + Buffer.byteLength("\r\n"));
            
            //Create a new buffer to store the chunk
            var chunk = new Buffer(chunkLength);
            binaryBuffer.copy(chunk);
            
            //Remove the data we parsed from the buffer
            binaryBuffer = binaryBuffer.slice(chunkLength + Buffer.byteLength("\r\n"));
            
            //TODO: Make this more memory efficient (don't create a new buffer every time a chunk comes in)
            binaryChunkBuffer = Buffer.concat([binaryChunkBuffer, chunk]);
            
            return false;
        
        } else if (httpObject.contentLength && httpObject.contentLength > 0) {
            
            var contentLength = parseInt(httpObject.contentLength);
            
            //Return if we do not have a complete body
            if (binaryBuffer.length < contentLength) return false;
            
            //Create a new buffer to store the body
            var body = new Buffer(contentLength);
            binaryBuffer.copy(body);
            
            httpObject.body = body;
            
            //Remove the data we parsed from the buffer
            binaryBuffer = binaryBuffer.slice(contentLength + Buffer.byteLength("\r\n"));
            
            return true;
            
        } else {
        
            //The HTTP response has no body (no content length and is not chunked)
            //We may need to strip off some newlines from the buffer...?
            httpObject.body = new Buffer(0);
            
            return true;
        }
    };
    
    var executeState = function() {
    
        switch (state) {
        
            case State.GET_FIRST_LINE:
                
                if (getFirstLine()) {
                
                    state = State.GET_HEADERS;
                    executeState();
                }
                break;
                
            case State.GET_HEADERS:
            
                if (getHeaders()) {
        
                    that.emit("headersLoaded", httpObject.headers);
                    
                    state = State.GET_BODY;
                    executeState();
                }
                break;
                
            case State.GET_BODY:
            
                if (getBody()) {
                    
                    //Decompress gzipped bodies
                    if (httpObject.contentEncoding && httpObject.contentEncoding.indexOf("gzip") !== -1) {
                        
                        //Store the raw (compressed) body in rawBody
                        httpObject.rawBody = httpObject.body;
                        
                        //Inflate (decompress) the body
                        try {
                        
                            httpObject.body = zlib.unzipSync(httpObject.rawBody);
                            
                        } catch(error) {
                        
                            that.emit("error", error);
                        }
                    }
                    
                    that.emit("bodyLoaded", httpObject.body);
                    that.emit("parseComplete", httpObject);
                    
                    state = State.GET_FIRST_LINE;
                    
                    //Create a new httpObject for the next pipelined request
                    httpObject = {
                        headers: []
                    };
                    
                    executeState();
                }
                break;
        }
        
        //console.log("Response State:", state);
    };
    
    
    //Public functions:
    
    this.pushChunk = function(chunk) {
        
        //TODO: Make this more memory efficient (don't create a new buffer every time a chunk comes in)
        binaryBuffer = Buffer.concat([binaryBuffer, chunk]);
        
        executeState();
    };
};

//Make RequestParser an event emitter
RequestParser.prototype.__proto__ = events.EventEmitter.prototype;

//Make ResponseParser an event emitter
ResponseParser.prototype.__proto__ = events.EventEmitter.prototype;

module.exports.RequestParser = RequestParser;
module.exports.ResponseParser = ResponseParser;
