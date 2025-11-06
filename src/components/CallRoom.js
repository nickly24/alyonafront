import React, { useEffect, useRef, useState } from 'react';
import './CallRoom.css';

function CallRoom({ socket, username, otherUser, callStatus, onLeaveCall }) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const isInitiatorRef = useRef(false);

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    if (!socket) return;

    // Инициализируем медиа поток
    initializeMedia();

    // Обработчики WebSocket событий
    socket.on('webrtc_offer', handleOffer);
    socket.on('webrtc_answer', handleAnswer);
    socket.on('webrtc_ice_candidate', handleIceCandidate);
    socket.on('call_started', (data) => {
      // Сохраняем информацию о том, кто инициатор
      isInitiatorRef.current = data.is_initiator || false;
      // Когда звонок начался, настраиваем WebRTC
      setupWebRTC();
    });
    socket.on('call_waiting', (data) => {
      // Сохраняем информацию о том, кто инициатор
      isInitiatorRef.current = data.is_initiator || false;
    });

    // Если звонок уже активен, настраиваем WebRTC сразу
    if (callStatus === 'active') {
      setupWebRTC();
    }

    return () => {
      cleanup();
    };
  }, [socket, callStatus]);

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error('Error accessing media devices:', error);
      let errorMessage = 'Не удалось получить доступ к камере/микрофону';
      if (error.name === 'NotAllowedError') {
        errorMessage = 'Доступ к камере/микрофону запрещен. Пожалуйста, разрешите доступ в настройках браузера.';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'Камера или микрофон не найдены. Убедитесь, что устройства подключены.';
      }
      alert(errorMessage);
    }
  };

  const setupWebRTC = () => {
    // Если уже есть соединение, не создаем новое
    if (peerConnectionRef.current) {
      return;
    }

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionRef.current = pc;

    // Добавляем локальный поток
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
      });
    }

    // Обработка удаленного потока
    pc.ontrack = (event) => {
      console.log('Received remote stream');
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Обработка ошибок соединения
    pc.onerror = (error) => {
      console.error('WebRTC error:', error);
    };

    // Обработка изменения состояния соединения
    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn('WebRTC connection failed or disconnected');
      }
    };

    // Обработка ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_ice_candidate', {
          username,
          candidate: event.candidate,
          room_id: 'call_room'
        });
      }
    };

    // Создаем offer (инициатор создает offer)
    if (isInitiatorRef.current) {
      setTimeout(() => createOffer(), 1000);
    }
  };

  const createOffer = async () => {
    try {
      if (!peerConnectionRef.current || !socket) {
        return;
      }

      const pc = peerConnectionRef.current;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socket.emit('webrtc_offer', {
        username,
        offer: pc.localDescription,
        room_id: 'call_room'
      });
    } catch (error) {
      console.error('Error creating offer:', error);
    }
  };

  const handleOffer = async (data) => {
    try {
      // Если соединения еще нет, создаем его
      if (!peerConnectionRef.current) {
        setupWebRTC();
        // Ждем немного, чтобы соединение установилось
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const pc = peerConnectionRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      
      if (socket) {
        socket.emit('webrtc_answer', {
          username,
          answer: pc.localDescription,
          room_id: 'call_room'
        });
      }
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  const handleAnswer = async (data) => {
    try {
      const pc = peerConnectionRef.current;
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (data) => {
    try {
      const pc = peerConnectionRef.current;
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoEnabled;
        setVideoEnabled(!videoEnabled);
      }
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioEnabled;
        setAudioEnabled(!audioEnabled);
      }
    }
  };

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
  };

  return (
    <div className="call-room-container">
      <div className="call-header">
        <h2 className="call-title">
          {callStatus === 'waiting' 
            ? `⏳ Ожидание подключения ${otherUser}...` 
            : `📞 Звонок с ${otherUser}`}
        </h2>
      </div>

      <div className="video-container">
        <div className="remote-video-wrapper">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="remote-video"
          />
          {callStatus === 'waiting' && (
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
          className={`control-button ${videoEnabled ? 'active' : 'inactive'}`}
          onClick={toggleVideo}
          title={videoEnabled ? 'Выключить видео' : 'Включить видео'}
        >
          {videoEnabled ? '📹' : '📹❌'}
        </button>
        <button
          className={`control-button ${audioEnabled ? 'active' : 'inactive'}`}
          onClick={toggleAudio}
          title={audioEnabled ? 'Выключить аудио' : 'Включить аудио'}
        >
          {audioEnabled ? '🎤' : '🎤❌'}
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

