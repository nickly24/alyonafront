import React, { useCallback, useEffect, useRef, useState } from "react";
import "./CallRoom.css";

function CallRoom({ socket, username, otherUser, callStatus, onLeaveCall }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const remoteMediaStreamRef = useRef(new MediaStream());
  const [remoteOrientation, setRemoteOrientation] = useState("landscape");
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [remoteStreamReady, setRemoteStreamReady] = useState(false);
  const isInitiatorRef = useRef(false);

  const iceServers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  };

  const cleanup = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        track.enabled = false;
      });
      localStreamRef.current = null;
    }
    if (remoteMediaStreamRef.current) {
      remoteMediaStreamRef.current.getTracks().forEach((track) => {
        remoteMediaStreamRef.current.removeTrack(track);
        track.stop();
      });
      remoteMediaStreamRef.current = new MediaStream();
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn("Error closing peer connection", err);
      }
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.onloadedmetadata = null;
      remoteVideoRef.current.onresize = null;
      remoteVideoRef.current.srcObject = null;
    }
    setRemoteStreamReady(false);
    setRemoteOrientation("landscape");
  }, []);

  const attachLocalStreamToPeerConnection = useCallback(
    (explicitPeerConnection) => {
      const pc = explicitPeerConnection || peerConnectionRef.current;
      const stream = localStreamRef.current;
      if (!pc || !stream) {
        return;
      }

      const existingSenders = pc.getSenders ? pc.getSenders() : [];

      stream.getTracks().forEach((track) => {
        const alreadyAdded = existingSenders.some(
          (sender) => sender.track && sender.track.id === track.id,
        );
        if (!alreadyAdded) {
          pc.addTrack(track, stream);
        }
      });
    },
    [],
  );

  const updateRemoteOrientation = useCallback(() => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
      return;
    }
    const orientation =
      videoEl.videoHeight > videoEl.videoWidth ? "portrait" : "landscape";
    setRemoteOrientation(orientation);
  }, []);

  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      attachLocalStreamToPeerConnection();
    } catch (error) {
      console.error("Error accessing media devices:", error);
      let errorMessage = "Не удалось получить доступ к камере/микрофону";
      if (error.name === "NotAllowedError") {
        errorMessage =
          "Доступ к камере/микрофону запрещен. Пожалуйста, разрешите доступ в настройках браузера.";
      } else if (error.name === "NotFoundError") {
        errorMessage =
          "Камера или микрофон не найдены. Убедитесь, что устройства подключены.";
      }
      alert(errorMessage);
    }
  }, [attachLocalStreamToPeerConnection]);

  const createOffer = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !socket) {
      return;
    }
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc_offer", {
        username,
        offer: pc.localDescription,
        room_id: "call_room",
      });
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  }, [socket, username]);

  const setupWebRTC = useCallback(() => {
    if (peerConnectionRef.current) {
      return;
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;

    attachLocalStreamToPeerConnection(pc);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteMediaStreamRef.current;
      remoteVideoRef.current.onloadedmetadata = updateRemoteOrientation;
      remoteVideoRef.current.onresize = updateRemoteOrientation;
    }

    pc.ontrack = (event) => {
      console.log("Received remote track", event.track?.kind);
      if (!remoteMediaStreamRef.current) {
        remoteMediaStreamRef.current = new MediaStream();
      }
      if (!remoteVideoRef.current) {
        return;
      }

      const remoteStream = remoteMediaStreamRef.current;
      const incomingTrack = event.track;
      if (incomingTrack) {
        const alreadyExists = remoteStream
          .getTracks()
          .some((track) => track.id === incomingTrack.id);
        if (!alreadyExists) {
          remoteStream.addTrack(incomingTrack);
        }
      }

      if (remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.playsInline = true;
        setRemoteStreamReady(true);
        updateRemoteOrientation();
        const playPromise = remoteVideoRef.current.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((err) => {
            console.warn(
              "Auto-play blocked, waiting for user interaction",
              err,
            );
          });
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("webrtc_ice_candidate", {
          username,
          candidate: event.candidate,
          room_id: "call_room",
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        console.warn("WebRTC connection failed or disconnected");
        setRemoteStreamReady(false);
      }
      if (pc.connectionState === "closed") {
        setRemoteStreamReady(false);
      }
    };

    if (isInitiatorRef.current) {
      // Небольшая задержка, чтобы завершить настройку
      setTimeout(() => {
        createOffer();
      }, 300);
    }
  }, [
    attachLocalStreamToPeerConnection,
    createOffer,
    socket,
    updateRemoteOrientation,
    username,
  ]);

  const handleOffer = useCallback(
    async (data) => {
      try {
        if (!peerConnectionRef.current) {
          setupWebRTC();
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const pc = peerConnectionRef.current;
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket?.emit("webrtc_answer", {
          username,
          answer: pc.localDescription,
          room_id: "call_room",
        });
      } catch (error) {
        console.error("Error handling offer:", error);
      }
    },
    [setupWebRTC, socket, username],
  );

  const handleAnswer = useCallback(async (data) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.warn("Peer connection missing while handling answer");
        return;
      }
      if (pc.signalingState === "closed") {
        console.warn("Peer connection already closed, skip remote description");
        return;
      }
      const incomingAnswer = new RTCSessionDescription(data.answer);
      const currentRemote = pc.currentRemoteDescription;
      if (currentRemote && currentRemote.sdp === incomingAnswer.sdp) {
        console.log("Remote description already set, skip duplicate answer");
        return;
      }
      await pc.setRemoteDescription(incomingAnswer);
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  }, []);

  const handleIceCandidate = useCallback(async (data) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error("Error handling ICE candidate:", error);
    }
  }, []);

  const handleCallStarted = useCallback(
    (data) => {
      isInitiatorRef.current = data.is_initiator || false;
      setupWebRTC();
    },
    [setupWebRTC],
  );

  const handleCallWaiting = useCallback((data) => {
    isInitiatorRef.current = data.is_initiator || false;
  }, []);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    initializeMedia();

    socket.off("webrtc_offer");
    socket.off("webrtc_answer");
    socket.off("webrtc_ice_candidate");
    socket.off("call_started");
    socket.off("call_waiting");

    socket.on("webrtc_offer", handleOffer);
    socket.on("webrtc_answer", handleAnswer);
    socket.on("webrtc_ice_candidate", handleIceCandidate);
    socket.on("call_started", handleCallStarted);
    socket.on("call_waiting", handleCallWaiting);

    return () => {
      socket.off("webrtc_offer", handleOffer);
      socket.off("webrtc_answer", handleAnswer);
      socket.off("webrtc_ice_candidate", handleIceCandidate);
      socket.off("call_started", handleCallStarted);
      socket.off("call_waiting", handleCallWaiting);
      cleanup();
    };
  }, [
    socket,
    initializeMedia,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    handleCallStarted,
    handleCallWaiting,
    cleanup,
  ]);

  useEffect(() => {
    if (callStatus === "active") {
      setupWebRTC();
    }
  }, [callStatus, setupWebRTC]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const [videoTrack] = localStreamRef.current.getVideoTracks();
      if (videoTrack) {
        setVideoEnabled((prev) => {
          const next = !prev;
          videoTrack.enabled = next;
          return next;
        });
      }
    }
  }, []);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const [audioTrack] = localStreamRef.current.getAudioTracks();
      if (audioTrack) {
        setAudioEnabled((prev) => {
          const next = !prev;
          audioTrack.enabled = next;
          return next;
        });
      }
    }
  }, []);

  return (
    <div className="call-room-container">
      <div className="call-header">
        <h2 className="call-title">
          {callStatus === "waiting"
            ? `⏳ Ожидание подключения ${otherUser}...`
            : `📞 Звонок с ${otherUser}`}
        </h2>
      </div>

      <div className="video-container">
        <div
          className={`remote-video-wrapper ${remoteOrientation === "portrait" ? "portrait" : ""}`}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`remote-video ${remoteOrientation === "portrait" ? "portrait" : ""}`}
          />
          {!remoteStreamReady && (
            <div className="waiting-overlay">
              <div className="spinner"></div>
              <p>Ожидание подключения...</p>
            </div>
          )}
        </div>

        <div className="local-video-wrapper">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="local-video"
          />
        </div>
      </div>

      <div className="call-controls">
        <button
          className={`control-button ${videoEnabled ? "active" : "inactive"}`}
          onClick={toggleVideo}
          title={videoEnabled ? "Выключить видео" : "Включить видео"}
        >
          {videoEnabled ? "📹" : "📹❌"}
        </button>
        <button
          className={`control-button ${audioEnabled ? "active" : "inactive"}`}
          onClick={toggleAudio}
          title={audioEnabled ? "Выключить аудио" : "Включить аудио"}
        >
          {audioEnabled ? "🎤" : "🎤❌"}
        </button>
        <button
          className="control-button end-call"
          onClick={() => {
            cleanup();
            onLeaveCall();
          }}
          title="Завершить звонок"
        >
          📞❌
        </button>
      </div>
    </div>
  );
}

export default CallRoom;
