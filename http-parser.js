var events = require("events");
var zlib = require("zlib");

var State = {
    GET_STATUS_CODE: 1,
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

var HTTPParser = function() {

    //Init:

    //Call the EventEmitter constructor
    events.EventEmitter.call(this);
    
    var that = this;
    
    
    //Private variables:
    
    //HTTP object that we will build
    var httpObject = {
        headers: []
    };
    
    //The start state will be looking for an HTTP status code
    var state = State.GET_STATUS_CODE;
    
    //Buffer to store incoming data chunks
    var binaryBuffer = new Buffer(0);
    
    
    //Private functions:
    
    var getStatusCode = function() {
        
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
    
        console.log("Transfer-encoding: ", httpObject.transferEncoding);
        
        if (httpObject.transferEncoding === "chunked") {
        
            console.log("Chunked encoding");
            
            var firstLineEnd = bufferIndexOf(binaryBuffer, "\r\n");
            
            //Return if we do not have a complete first line
            if (firstLineEnd === -1) return false;
            
            //The first line of the body indicates the chunk length in bytes
            var chunkLength = parseInt(binaryBuffer.toString("hex", 0, firstLineEnd));
            
            //Return if we do not have a valid chunk length (throw error?)
            if (isNaN(chunkLength)) return false;
            
            //Remove the data we parsed from the buffer
            binaryBuffer = binaryBuffer.slice(firstLineEnd + Buffer.byteLength("\r\n"));
            
            console.log("Chunk length:", chunkLength);
            console.log("binaryBuffer:", binaryBuffer.toString());
            
            //Create a new buffer to store the chunk
            var body = new Buffer(chunkLength);
            binaryBuffer.copy(body);
            
            console.log("body:", body.toString());
            
            //temp
            /*var result = zlib.unzipSync(body);
            
            console.log("Result:", result.toString());*/
            
            return false;
        
        } else if (httpObject.contentLength && httpObject.contentLength > 0) {
            
            var contentLength = parseInt(httpObject.contentLength);
            
            //Return if we do not have a complete body
            if (binaryBuffer.length < contentLength) return false;
            
            //Create a new buffer to store the body
            var body = new Buffer(contentLength);
            binaryBuffer.copy(body);
            
            httpObject.body = body;
            
            return true;
            
        } else {
        
            //The HTTP response has no body (no content length and is not chunked)
            //We may need to strip off some newlines from the buffer...?
            return true;
        }
    };
    
    var executeState = function() {
    
        switch (state) {
        
            case State.GET_STATUS_CODE:
                
                if (getStatusCode()) {
                
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
                    
                    state = State.PARSE_COMPLETE;
                }
                break;
        }
        
        console.log("State:", state);
    };
    
    
    //Public functions:
    
    this.pushChunk = function(chunk) {
        
        //TODO: Make this more memory efficient (don't create a new buffer every time a chunk comes in)
        binaryBuffer = Buffer.concat([binaryBuffer, chunk]);
        
        executeState();
    };
};

//Make HTTPParser an event emitter
HTTPParser.prototype.__proto__ = events.EventEmitter.prototype;

module.exports.HTTPParser = HTTPParser;
