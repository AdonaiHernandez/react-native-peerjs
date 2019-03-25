import { util } from "./util";
import { EventEmitter } from "eventemitter3";

export class Socket extends  EventEmitter{
    constructor(secure, host, port, path, key, wsport){
        super();

        wsport = wsport || port;

        this.disconnected = false;
        this._queue = [];

        const httpProtocol = secure ? "https://" : "http://";
        const wsProtocol = secure ? "wss://" : "ws://";
        this._httpUrl = httpProtocol + host + ":" + port + path + key;
        this._wsUrl = wsProtocol + host + ":" + wsport + path + "peerjs?key=" + key;
    }

    start(id, token){
        this.id = id;

        this._httpUrl += "/" + id + "/" + token;
        this._wsUrl += "&id=" + id + "&token=" + token;

        this._startXhrStream();
        this._startWebSocket();
    }

    _startWebSocket(id) {
        if (this._socket)
            return;

        this._socket = new WebSocket(this._wsUrl);

        this._socket.onmessage = (event) => {
            let data;
            try {
                data = JSON.parse(event.data);
            } catch (e) {
                console.warn("Invalid server message",event.data);
            }

            this.emit("message", data);

        };

        this._socket.onclose = (event) => {
            this.disconnected = true;
            this.emit("disconnected");
        };

        this._socket.onopen = () => {
            if (this._timeout){
                clearTimeout(this._timeout);
                setTimeout(() => {
                    this._http.abort();
                    this._http = null;
                }, 5000)
            }
            this._sendQueuedMessages();
            console.log("socket open");
        };

    };

    _startXhrStream(n)  {

        try {
            const self = this;
            this._http = new XMLHttpRequest();
            this._http._index = 1;
            this._http._streamIndex = n || 0;
            this._http.open("post", this._httpUrl + "/id?i=" + this._http._streamIndex, true);
            this._http.onerror = () => {
                clearTimeout(this._timeout);
                this.emit("disconnected");
            };
            this._http.onreadystatechange = function() {
                if (this.readyState == 2 && this.old) {
                    this.old.abort();
                    delete this.old;
                } else if (
                    this.readyState > 2 &&
                    this.status === 200 &&
                    this.responseText
                ) {
                    self._handleStream(this);
                }
            };
            this._http.send(null);
            this._setHTTPTimeout();
        } catch (e) {
            console.log("XMLHttpRequest not available; defaulting to WebSockets");
        }

    };

    _handleStream(http) {
        const messages = http.responseText.split("\n");

        if (http._buffer){
            while (http._buffer.length > 0) {
                const index = http._buffer.shift();
                let bufferedMessage = messages[index];
                try{
                    bufferedMessage = JSON.parse(bufferedMessage);
                } catch (e) {
                    http._buffer.shift(index);
                    break;
                }
                this.emit("message", bufferedMessage);
            }
        }

        let message = messages[http._index];
        if (message) {
            http._index += 1;

            if (http._index === messages.length){
                if (!http._buffer){
                    http._buffer = [];
                }
                http._buffer.push(http._index - 1);
            } else {

                try{
                    message = JSON.parse(message);
                } catch (e) {
                    console.warn("Invalid server message", message)
                    return
                }
                this.emit("message", message);

            }
        }
    };

    _setHTTPTimeout() {
        this._timeout = setTimeout(() => {
            const old = this._http;
            if (!this._wsOpen()) {
                this._startXhrStream(old._streamIndex + 1);
                this._http.old = old;
            } else {
                old.abort();
            }
        }, 25000);
    };

    _wsOpen() {
        return this._socket && this._socket.readyState == 1;
    }

    _sendQueuedMessages() {
        for (let i = 0, ii = this._queue.length; i < ii; i += 1) {
            this.send(this._queue[i]);
        }
    };

    send(data) {
        if (this.disconnected) {
            return;
        }

        // If we didn't get an ID yet, we can't yet send anything so we should queue
        // up these messages.
        if (!this.id) {
            this._queue.push(data);
            return;
        }

        if (!data.type) {
            this.emit("error", "Invalid message");
            return;
        }

        let message = JSON.stringify(data);
        if (this._wsOpen()) {
            this._socket.send(message);
        } else {
            const http = new XMLHttpRequest();
            const url = this._httpUrl + "/" + data.type.toLowerCase();
            http.open("post", url, true);
            http.setRequestHeader("Content-Type", "application/json");
            http.send(message);
        }
    };

    close() {
        if (!this.disconnected && this._wsOpen()) {
            this._socket.close();
            this.disconnected = true;
        }
    };

}
