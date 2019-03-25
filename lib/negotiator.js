import { util } from "./util";
import {
    RTCPeerConnection,
    RTCSessionDescription,
    RTCIceCandidate
} from "react-native-webrtc";

export const Negotiator = {
    pcs: {
        data: {},
        media: {}
    }, // type => {peerId: {pc_id: pc}}.
    //providers: {}, // provider's id => providers (there may be multiple providers/client.
    queue: [] // connections that are delayed due to a PC being in use.
};

Negotiator._idPrefix = "pc_";

Negotiator.startConnection = (connection, options) => {

    const pc = Negotiator._getPeerConnection(connection, options);

    if (connection.type === "media" && options._stream) {
        addStreamToConnection(options._stream, pc);
    }

    if (options.originator){
        if (connection.type === "data"){
            let config = {};

            if (!util.supports.sctp){
                config = { reliable: options.reliable }
            }
            const dc = pc.createDataChannel(connection.label, config);
            connection.initialize(dc);
        }

        Negotiator._makeOffer(connection);

    } else {
        Negotiator.handleSDP("OFFER", connection, options.sdp);
    }
    
};

Negotiator._getPeerConnection = (connection, options) => {
    if (!Negotiator.pcs[connection.type]) {
        console.error(
            connection.type +
            " is not a valid connection type. Maybe you overrode the `type` property somewhere."
        );
    }

    if (!Negotiator.pcs[connection.type][connection.peer]) {
        Negotiator.pcs[connection.type][connection.peer] = {};
    }
    const peerConnections = Negotiator.pcs[connection.type][connection.peer];

    let pc;
    // Not multiplexing while FF and Chrome have not-great support for it.
    /*if (options.multiplex) {
      ids = Object.keys(peerConnections);
      for (var i = 0, ii = ids.length; i < ii; i += 1) {
        pc = peerConnections[ids[i]];
        if (pc.signalingState === 'stable') {
          break; // We can go ahead and use this PC.
        }
      }
    } else */
    if (options.pc) {
        // Simplest case: PC id already provided for us.
        pc = Negotiator.pcs[connection.type][connection.peer][options.pc];
    }

    if (!pc || pc.signalingState !== "stable") {
        pc = Negotiator._startPeerConnection(connection);
    }
    return pc;
};

Negotiator._startPeerConnection = (connection) => {

    console.log("Creating RTCPeerConnection");
    const id = Negotiator._idPrefix + util.randomToken();
    let optional = {};

    if (connection.type === "data" && !util.supports.sctp) {
        optional = { optional: [{ RtpDataChannels: true }] };
    } else if (connection.type === "media") {
        // Interop req for chrome.
        optional = { optional: [{ DtlsSrtpKeyAgreement: true }] };
    }

    const pc = new RTCPeerConnection(connection.provider.options.config, optional);
    Negotiator.pcs[connection.type][connection.peer][id] = pc;

    Negotiator._setupListeners(connection, pc, id);

    return pc;

};

Negotiator._setupListeners = (connection, pc, pc_id) => {

    const peerId = connection.peer;
    const connectionId = connection.id;
    const provider = connection.provider;

    pc.onicecandidate = (evt) => {

        if (evt.candidate){
            provider.socket.send({
                type: "CANDIDATE",
                payload: {
                    candidate: evt.candidate,
                    type: connection.type,
                    connectionId: connection.id
                },
                dst: peerId
            });
        }

    };

    pc.oniceconnectionstatechange = () => {
        switch (pc.iceConnectionState) {
            case "failed":
                connection.emit(
                    "error",
                    new Error("Negotiation of connection to " + peerId + " failed.")
                );
                connection.close();
                break;
            case "disconnected":
                break;
            case "completed":
                pc.onicecandidate = void {};
                break;
        }
    };

    pc.onicechange = pc.oniceconnectionstatechange;

    pc.ondatachannel = (evt) => {
        const dc = evt.channel;
        const connection = provider.getConnection(peerId, connectionId);
        connection.initialize(dc);
    };

    pc.ontrack = (evt) => {

        const stream = evt.streams[0];
        const connection = provider.getConnection(peerId, connectionId);

        if (connection.type === "media"){
            addStreamToConnection(stream, connection);
        }

    };

    pc.onaddstream = (evt) => {

        const stream = evt.stream;
        const connection = provider.getConnection(peerId, connectionId);

        if (connection.type === "media") {
            addStreamToConnection(stream, connection);
        }
    };

};

Negotiator.cleanup = (connection) => {

    const pc = connection.pc;

    if (!!pc && ((pc.readyState && pc.readyState !== "closed") || pc.signalingState !== "closed")) {
        pc.close();
        connection.pc = null;
    }

};

Negotiator._makeOffer = (connection) => {

    const pc = connection.pc;
    const callback = (offer) => {

       /* if (!util.supports.sctp && connection.type === "data" && connection.reliable){
            offer.sdp = Reliable.higherBandwidthSDP(offer.sdp);
        }*/

        const descCallback = () => {
            connection.provider.socket.send({
                type: "OFFER",
                payload: {
                    sdp: offer,
                    type: connection.type,
                    label: connection.label,
                    connectionId: connection.id,
                    reliable: connection.reliable,
                    serialization: connection.serialization,
                    metadata: connection.metadata,
                    browser: util.browser
                },
                dst: connection.peer
            });
        };
        const descError = function(err) {
            if (err !== "OperationError: Failed to set local offer sdp: Called in wrong state: kHaveRemoteOffer") {
                connection.provider.emitError("webrtc", err);
                util.log("Failed to setLocalDescription, ", err);
            }

        };
        pc.setLocalDescription(offer)
            .then(() => descCallback())
            .catch(err => descError(err));



    };

    const errorHandler = function(err) {
        connection.provider.emitError("webrtc", err);
    };
    pc.createOffer(connection.options.constraints)
        .then(offer => callback(offer))
        .catch(err => errorHandler(err));

};

Negotiator._makeAnswer = (connection) => {
    const pc = connection.pc;
    const callback = (answer) => {

        /*if (!util.supports.sctp && connection.type === "data" && connection.reliable) {
            answer.sdp = Reliable.higherBandwidthSDP(answer.sdp);
        }*/
        const descCallback = () => {
            connection.provider.socket.send({
                type: "ANSWER",
                payload: {
                    sdp: answer,
                    type: connection.type,
                    connectionId: connection.id,
                    browser: util.browser
                },
                dst: connection.peer
            });
        };

        pc.setLocalDescription(answer)
            .then(() => descCallback())
            .catch(err => {
                connection.provider.emitError("webrtc", err);
            });

    };

    pc.createAnswer()
        .then(answer => callback(answer))
        .catch(err => {
            connection.provider.emitError("webrtc", err);
        });
};

Negotiator.handleSDP = (type, connection, sdp) => {

    sdp = new RTCSessionDescription(sdp);
    const pc = connection.pc;

    const callback = () => {

        if (type === "OFFER"){
            Negotiator._makeAnswer(connection)
        }

    };

    pc.setRemoteDescription(sdp)
        .then(() => callback())
        .catch(err => {
                connection.provider.emitError("webrtc", err);
            }
        );
};

Negotiator.handleCandidate = (connection, ice) => {

    const {candidate, sdpMLineIndex, sdpMid} = ice;

    connection.pc.addIceCandidate(new RTCIceCandidate({
        candidate: candidate,
        sdpMLineIndex: sdpMLineIndex,
        sdpMid: sdpMid
    }));
};

addStreamToConnection = (stream, connection) => {

    if ('addTrack' in connection) {
        stream.getTracks().forEach(track => {
            connection.addTrack(track, stream);
        });
    } else if ('addStream' in connection) {
        connection.addStream(stream);
    }

};
