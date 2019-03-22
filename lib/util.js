import { RTCPeerConnection } from "react-native-webrtc";

const DEFAULT_CONFIG = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

export class util {

    CLOUD_HOST = "0.peerjs.com";
    CLOUD_PORT = 443;

    validateId(id) {
        // Allow empty ids
        return !id || /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/.test(id);
    }

    extend(dest, source) {
        for (let key in source) {
          if (source.hasOwnProperty(key)) {
            dest[key] = source[key];
          }
        }
        return dest;
    }

    randomToken() {
       return Math.random()
        .toString(36)
        .substr(2);
    }

};