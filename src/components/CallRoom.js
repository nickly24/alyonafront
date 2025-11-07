import React, { useCallback, useEffect, useRef, useState } from "react";
import "./CallRoom.css";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function CallRoom({ socket, username, otherUser, callStatus, onLeaveCall }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(new MediaStream());
  const peerConnectionRef = useRef(null);
  const isInitiatorRef = useRef(false);

  const [localVideoEnabled, setLocalVideoEnabled] = useState(false);
  const [localAudioEnabled, setLocalAudioEnabled] = useState(true);
  const [remoteVideoPresent, setRemoteVideoPresent] = useState(false);
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false);
  const [remoteOrientation, setRemoteOrientation] = useState("landscape");

  const updateRemoteOrientation = useCallback(() => {
    const videoEl = remoteVideoRef.current;
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
      return;
    }
    const nextOrientation =
      videoEl.videoHeight > videoEl.videoWidth ? "portrait" : "landscape";
    setRemoteOrientation(nextOrientation);
  }, []);

  const cleanup = useCallback(() => {
    const localStream = localStreamRef.current;
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        track.stop();
      });
      localStreamRef.current = null;
    }

    const remoteStream = remoteStreamRef.current;
    if (remoteStream) {
      remoteStream.getTracks().forEach((track) => {
        track.onmute = null;
        track.onunmute = null;
        track.onended = null;
        track.stop();
      });
    }
    remoteStreamRef.current = new MediaStream();

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.onicecandidate = null;
        peerConnectionRef.current.ontrack = null;
        peerConnectionRef.current.onconnectionstatechange = null;
        peerConnectionRef.current.close();
      } catch (error) {
        console.warn("Ошибка при закрытии RTCPeerConnection", error);
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

    setRemoteVideoPresent(false);
    setRemoteVideoEnabled(false);
    setRemoteOrientation("landscape");
  }, []);

  const attachLocalTracks = useCallback((pc) => {
    const localStream = localStreamRef.current;
    if (!pc || !localStream) {
      return;
    }

    const existingSenders = pc.getSenders ? pc.getSenders() : [];
    localStream.getTracks().forEach((track) => {
      const alreadyAdded = existingSenders.some(
        (sender) => sender.track && sender.track.id === track.id,
      );
      if (!alreadyAdded) {
        pc.addTrack(track, localStream);
      }
    });
  }, []);

  const ensurePeerConnection = useCallback(() => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit("webrtc_ice_candidate", {
          username,
          candidate: event.candidate,
          room_id: "call_room",
        });
      }
    };

    pc.ontrack = (event) => {
      const incomingTrack = event.track;
      let remoteStream = null;

      if (event.streams && event.streams.length > 0) {
        [remoteStream] = event.streams;
        remoteStreamRef.current = remoteStream;
      } else {
        remoteStream = remoteStreamRef.current;
        if (!remoteStream.getTrackById(incomingTrack.id)) {
          remoteStream.addTrack(incomingTrack);
        }
      }

      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        remoteVideoRef.current.playsInline = true;
      }

      if (incomingTrack.kind === "video") {
        setRemoteVideoPresent(true);
        setRemoteVideoEnabled(!incomingTrack.muted);

        incomingTrack.onmute = () => {
          setRemoteVideoEnabled(false);
        };
        incomingTrack.onunmute = () => {
          setRemoteVideoEnabled(true);
          updateRemoteOrientation();
        };
        incomingTrack.onended = () => {
          setRemoteVideoEnabled(false);
          setRemoteVideoPresent(false);
        };

        updateRemoteOrientation();
        const playPromise = remoteVideoRef.current?.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((error) => {
            console.warn(
              "Автовоспроизведение удалённого видео заблокировано",
              error,
            );
          });
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("RTC state:", state);
      if (state === "failed" || state === "disconnected" || state === "closed") {
        setRemoteVideoPresent(false);
        setRemoteVideoEnabled(false);
      }
    };

    attachLocalTracks(pc);

    if (remoteVideoRef.current) {
      remoteVideoRef.current.onloadedmetadata = updateRemoteOrientation;
      remoteVideoRef.current.onresize = updateRemoteOrientation;
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }

    return pc;
  }, [attachLocalTracks, socket, updateRemoteOrientation, username]);

  const initializeMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;

      stream.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.playsInline = true;
        const playPromise = localVideoRef.current.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {
            /* игнорируем блокировку автоплея локального превью */
          });
        }
      }

      const pc = peerConnectionRef.current;
      if (pc) {
        attachLocalTracks(pc);
      }
    } catch (error) {
      console.error("Ошибка доступа к камере/микрофону:", error);
      let message = "Не удалось получить доступ к камере/микрофону";
      if (error.name === "NotAllowedError") {
        message =
          "Доступ к камере или микрофону запрещён. Разрешите доступ в настройках браузера.";
      } else if (error.name === "NotFoundError") {
        message =
          "Камера или микрофон не найдены. Убедитесь, что устройства подключены.";
      }
      alert(message);
    }
  }, [attachLocalTracks]);

  const createOffer = useCallback(async () => {
    const pc = ensurePeerConnection();
    if (!pc || pc.connectionState === "closed") {
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
      console.error("Ошибка при создании offer:", error);
    }
  }, [ensurePeerConnection, socket, username]);

  const handleOffer = useCallback(
    async (data) => {
      try {
        const pc = ensurePeerConnection();
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc_answer", {
          username,
          answer: pc.localDescription,
          room_id: "call_room",
        });
      } catch (error) {
        console.error("Ошибка при обработке offer:", error);
      }
    },
    [ensurePeerConnection, socket, username],
  );

  const handleAnswer = useCallback(
    async (data) => {
      try {
        const pc = peerConnectionRef.current;
        if (!pc || pc.signalingState === "closed") {
          return;
        }
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } catch (error) {
        console.error("Ошибка при обработке answer:", error);
      }
    },
    [],
  );

  const handleIceCandidate = useCallback(async (data) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc || pc.signalingState === "closed") {
        return;
      }
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error("Ошибка при добавлении ICE candidate:", error);
    }
  }, []);

  const handleCallWaiting = useCallback((data) => {
    isInitiatorRef.current = !!data?.is_initiator;
  }, []);

  const handleCallStarted = useCallback(
    (data) => {
      isInitiatorRef.current = !!data?.is_initiator;
      setRemoteVideoPresent(false);
      setRemoteVideoEnabled(false);
      const pc = ensurePeerConnection();
      if (pc && isInitiatorRef.current) {
        // даём браузеру время добавить все треки
        setTimeout(() => {
          if (peerConnectionRef.current === pc) {
            createOffer();
          }
        }, 200);
      }
    },
    [createOffer, ensurePeerConnection],
  );

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    initializeMedia();

    socket.on("webrtc_offer", handleOffer);
    socket.on("webrtc_answer", handleAnswer);
    socket.on("webrtc_ice_candidate", handleIceCandidate);
    socket.on("call_waiting", handleCallWaiting);
    socket.on("call_started", handleCallStarted);

    return () => {
      socket.off("webrtc_offer", handleOffer);
      socket.off("webrtc_answer", handleAnswer);
      socket.off("webrtc_ice_candidate", handleIceCandidate);
      socket.off("call_waiting", handleCallWaiting);
      socket.off("call_started", handleCallStarted);
      cleanup();
    };
  }, [
    socket,
    initializeMedia,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    handleCallWaiting,
    handleCallStarted,
    cleanup,
  ]);

  useEffect(() => {
    if (callStatus === "active") {
      ensurePeerConnection();
    }
  }, [callStatus, ensurePeerConnection]);

  const toggleVideo = useCallback(() => {
    const localStream = localStreamRef.current;
    if (!localStream) {
      return;
    }
    const [videoTrack] = localStream.getVideoTracks();
    if (!videoTrack) {
      return;
    }
    setLocalVideoEnabled((prev) => {
      const next = !prev;
      videoTrack.enabled = next;
      return next;
    });
  }, []);

  const toggleAudio = useCallback(() => {
    const localStream = localStreamRef.current;
    if (!localStream) {
      return;
    }
    const [audioTrack] = localStream.getAudioTracks();
    if (!audioTrack) {
      return;
    }
    setLocalAudioEnabled((prev) => {
      const next = !prev;
      audioTrack.enabled = next;
      return next;
    });
  }, []);

  const headerText =
    callStatus === "waiting"
      ? `⏳ Ожидаем подключение ${otherUser}`
      : `📞 Звонок с ${otherUser}`;

  return (
    <div className="call-room-container">
      <div className="call-header">
        <h2 className="call-title">{headerText}</h2>
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

          {!remoteVideoPresent && (
            <div className="waiting-overlay">
              <div className="spinner"></div>
              <p>Ждём собеседника...</p>
            </div>
          )}

          {remoteVideoPresent && !remoteVideoEnabled && (
            <div className="video-off-overlay remote">
              <span className="video-off-icon">📵</span>
              <span>Камера собеседника выключена</span>
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

          {!localVideoEnabled && (
            <div className="video-off-overlay local">
              <span className="video-off-icon">📵</span>
              <span>Ваша камера выключена</span>
            </div>
          )}
        </div>
      </div>

      <div className="call-controls">
        <button
          className={`control-button ${localVideoEnabled ? "active" : "inactive"}`}
          onClick={toggleVideo}
          title={localVideoEnabled ? "Выключить видео" : "Включить видео"}
        >
          {localVideoEnabled ? "📹" : "📹❌"}
        </button>

        <button
          className={`control-button ${localAudioEnabled ? "active" : "inactive"}`}
          onClick={toggleAudio}
          title={localAudioEnabled ? "Выключить звук" : "Включить звук"}
        >
          {localAudioEnabled ? "🎤" : "🎤❌"}
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
