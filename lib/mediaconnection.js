import { util } from "./util";
import { EventEmitter } from "eventemitter3";
import { Negotiator } from "./negotiator";

export class MediaConnection extends EventEmitter {

    _idPrefix = "mc_";

    constructor(peer, provider, options) {
        super();
        this.options = util.extend({}, options);

        this.open = false;
        this.type = "media";
        this.peer = peer;
        this.provider = provider;
        this.metadata = this.options.metadata;
        this.localStream = this.options._stream;

        this.id = this.options.connectionId || MediaConnection._idPrefix + util.randomToken();
        if (this.localStream) {
            Negotiator.startConnection(this, {
            _stream: this.localStream,
            originator: true
            });
        }
    }

    addStream(remoteStream) {
        this.remoteStream = remoteStream;
        this.emit('stream', remoteStream);
    }

    handleMessage(message) {
        const {payload} = message;

        switch (message.type) {
            case "ANSWER":
                Negotiator.handleSDP(message.type, this, payload.sdp);
                this.open = true;
                break;
            case "CANDIDATE":
                Negotiator.handleCandidate(this, payload.candidate);
                break;
            default:
                console.warn(
                    "Unrecognized message type:",
                    message.type,
                    "from peer:",
                    this.peer);        
        }
    }

    answer(stream) {
        if (this.localStream) {
            console.warn(
              "Local stream already exists on this MediaConnection. Are you answering a call twice?"
            );
            return;
        }

        this.options._payload._stream = stream;

        this.localStream = stream;
        Negotiator.startConnection(this, this.options._payload);
        // Retrieve lost messages stored because PeerConnection not set up.
        const messages = this.provider._getMessages(this.id);
        for (let i = 0, ii = messages.length; i < ii; i += 1) {
            this.handleMessage(messages[i]);
        }
        this.open = true;
    }

    close() {
        if (!this.open) {
            return;
        }
        this.open = false;
        Negotiator.cleanup(this);
        this.emit("close"); 
    }

}
