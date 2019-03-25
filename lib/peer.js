import { util } from "./util";
import { EventEmitter } from "eventemitter3";
//import { DataConnection } from "./dataconnection";
import { MediaConnection } from "./mediaconnection";
import { Socket } from "./socket";

export class Peer extends EventEmitter {

    constructor(id, options){
        super();

        this.options = util.extend(
            {
              debug: 0, // 1: Errors, 2: Warnings, 3: All logs
              host: util.CLOUD_HOST,
              port: util.CLOUD_PORT,
              path: "/",
              key: "peerjs",
              token: util.randomToken(),
              config: util.defaultConfig,
              secure: false
            },
            options
        );

        if (!util.validateId(id)) {
            throw "invalid-id", 'ID "' + id + '" is invalid';
        }  
        
        this.destroyed = false; // Connections have been killed
        this.disconnected = false; // Connection to PeerServer killed but P2P connections still active
        this.open = false; // Sockets and such are not yet open.
        this.connections = {}; // DataConnections for this peer.
        this._lostMessages = {}; // src => [list of messages]

        this._initializeServerConnection();
        if (id) {
            this._initialize(id);
        } else {
            this._retrieveId();
        }

    }

    _initializeServerConnection() {
        this.socket = new Socket(
            this.options.secure,
            this.options.host,
            this.options.port,
            this.options.path,
            this.options.key,
            this.options.wsport
        );

        this.socket.on('message', (data) => {
            this._handleMessage(data);
        });

        this.socket.on('error', (error) => {
            this._abort("socket-error", error);
        });

        this.socket.on('disconnected', () => {
            if (!this.disconnected){
                this.emitError('network', 'Lost connection to server.');
                this.disconnected();
            }
        });

        this.socket.on('close', () => {
            if (!self.disconnected) {
                this._abort("socket-closed", "Underlying socket is already closed.");
              }
        });
    }

    _retrieveId() {
        const http = new XMLHttpRequest();
        const protocol = this.options.secure ? 'https://' : 'http://';
        const url = `${protocol+this.options.host}:${this.options.port+this.options.path+this.options.key}/id?ts=${new Date().getTime().toString()+Math.random()}`;

        http.open('get', url, true);
        
        http.onerror = e => { throw e };
        
        http.onreadystatechange = () => {
            if (http.readyState !== 4) {
                return;
            }
            if (http.status !== 200) {
                http.onerror();
                return;
            }
            this._initialize(http.responseText);
        };
    }

    _initialize(id) {
        this.id = id;
        this.socket.start(this.id, this.options.token);
    }

    _handleMessage(message) {
        const {type, payload} = message;
        const peer = message.src;
        let connection;

        switch (type) {
            case 'OPEN':
                this.emit('open', this.id);
                this.open = true;
                break;
            case 'ERROR':
                this._abort("server-error", payload.msg);
                break;
            case 'ID-TAKEN':
                this._abort("unavailable-id", "ID `" + this.id + "` is taken");    
                break;
            case 'INVALID-KEY':
                this._abort(
                    "invalid-key",
                    'API KEY "' + this.options.key + '" is invalid'
                );
                break;  
            case 'LEAVE':
                this._cleanupPeer(peer);
                break;
            case 'EXPIRE':
                this.emitError("peer-unavailable", "Could not connect to peer " + peer);
                break;
            case 'OFFER':
                const connectionId = payload.connectionId;
                connection = this.getConnection(peer, connectionId);

                if (connection){
                    connection.close();
                    console.warn("Offer received for existing Connection ID:", connectionId);
                }

                if (payload.type === "media"){
                    connection = new MediaConnection(peer, this, {
                        connectionId: connectionId,
                        _payload: payload,
                        metadata: payload.metadata
                    });

                    this._addConnection(peer, connection); 
                    this.emit('call', connection);
                } else if (payload.type === "data"){
                    // TODO
                    /*connection = new DataConnection(peer, this, {
                        connectionId: connectionId,
                        _payload: payload,
                        metadata: payload.metadata,
                        label: payload.label,
                        serialization: payload.serialization,
                        reliable: payload.reliable
                    });
                    this._addConnection(peer, connection);
                    this.emit("connection", connection);*/
                } else {
                    console.warn("Received malformed connection type:", payload.type);
                    return;
                }

                const messages = this._getMessages(connectionId);
                for (let i = 0; i < messages.lenght; i++){
                    connection.handleMessage(messages[i]);
                }

                break;
            default:
                if (!payload){
                    console.warn("You received a malformed message from " + peer + " of type " + type);
                    return;
                }    

                const id = payload.connectionId;
                connection = this.getConnection(peer, id);

                if (connection && connection.pc){
                    connection.handleMessage(message);
                } else if (id){
                    this._storeMessage(id, message);
                } else {
                    console.warn("You received an unrecognized message:", message);
                }
                break;
        }
    }

    _storeMessage(connectionId, message) {
        if (!this._lostMessages[connectionId]){
            this._lostMessages[connectionId] = [];
        }
        this._lostMessages[connectionId].push(message);
    }

    _getMessages(connectionId){
        const messages = this._lostMessages[connectionId];
        if (messages){
            delete this._lostMessages[connectionId];
            return messages;
        } else{
            return [];
        }
    }

    connect (peer, options){
        //TODO
        /*if (this.disconnected){
            throw "Cannot connect to new Peer after disconnecting from server.";
            return;
        }

        const connection = new DataConnection(peer, this, options);
        this._addConnection(peer, connection);
        return connection;*/
    }

    call(peer, stream, options = {}) {
        if (this.disconnected){
            throw "Cannot connect to new Peer after disconnecting from server.";
            return;
        }
        if (!stream) {
            throw "To call a peer, you must provide a stream"
            return;
        }
        options._stream = stream;
        const call = new MediaConnection(peer, this, options);
        this._addConnection(peer, call);
        return call;
    }
    
    _addConnection(peer, connection){
        if (!this.connections[peer]) {
            this.connections[peer] = [];
        }
        this.connections[peer].push(connection);
    }

    getConnection(peer, id) {
        const connections = this.connections[peer];
        if (!connections) {
            return null;
        }
        for (let i = 0, ii = connections.length; i < ii; i++) {
            if (connections[i].id === id) {
            return connections[i];
            }
        }
        return null;
    }

    emitError(type, err){
        throw err;
    }

    destroy() {
        if (!this.destroyed){
            this._cleanup();
            this.disconnect();
            this.destroyed = true;
        }
    }

    _cleanup() {
        if (this.connections) {
            const peers = Object.keys(this.connections);
            for (let i = 0, ii = peers.length; i < ii; i++) {
                this._cleanupPeer(peers[i]);
            }
        }
        this.emit("close");
    }

    _cleanupPeer(peer) {
        const connections = this.connections[peer];
        for (let j = 0, jj = connections.length; j < jj; j += 1) {
            connections[j].close();
        }
    }

    disconnect() {
        if (!this.disconnected) {
            this.disconnected = true;
            this.open = false;
            if (this.socket) {
                this.socket.close();
            }
            this.emit("disconnected", this.id);
            this._lastServerId = this.id;
            this.id = null;
          }
    }

    reconnect() {
        //TODO
    }

}
