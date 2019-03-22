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

    
};