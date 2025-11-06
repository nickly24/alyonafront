import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import io from 'socket.io-client';
import CallRoom from './CallRoom';
import logo from '../img/logopng.png';
import './Dashboard.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'https://nickly24-alyonaback-e4c2.twc1.net';

function Dashboard() {
  const { username } = useParams();
  const navigate = useNavigate();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [callStatus, setCallStatus] = useState('idle'); // idle, waiting, active
  const [otherUser, setOtherUser] = useState(null);

  useEffect(() => {
    if (username !== 'alyona' && username !== 'kolia') {
      navigate('/');
      return;
    }

    // Подключаемся к WebSocket
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      timeout: 20000
    });

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
      // Логинимся
      newSocket.emit('user_login', { username });
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('login_success', (data) => {
      console.log('Login success:', data);
    });

    newSocket.on('user_online', (data) => {
      console.log('User online:', data);
      if (data.username !== username) {
        setOtherUser(data.username);
      }
    });

    newSocket.on('call_waiting', (data) => {
      console.log('Call waiting:', data);
      setCallStatus('waiting');
      setInCall(true);
    });

    newSocket.on('call_started', (data) => {
      console.log('Call started:', data);
      setCallStatus('active');
      setInCall(true);
    });

    newSocket.on('user_left_call', (data) => {
      console.log('User left call:', data);
      alert(data.message || 'Пользователь покинул звонок');
      setCallStatus('idle');
      setInCall(false);
    });

    newSocket.on('error', (data) => {
      console.error('Error:', data);
    });

    setSocket(newSocket);

    // Определяем другого пользователя
    const other = username === 'alyona' ? 'kolia' : 'alyona';
    setOtherUser(other);

    return () => {
      newSocket.close();
    };
  }, [username, navigate]);

  const handleJoinCall = () => {
    if (socket && isConnected) {
      socket.emit('join_call', { username });
      setInCall(true);
      setCallStatus('waiting');
    }
  };

  const handleLeaveCall = () => {
    if (socket) {
      socket.emit('leave_call', { username, room_id: 'call_room' });
      setInCall(false);
      setCallStatus('idle');
    }
  };

  if (inCall) {
    return (
      <CallRoom
        socket={socket}
        username={username}
        otherUser={otherUser}
        callStatus={callStatus}
        onLeaveCall={handleLeaveCall}
      />
    );
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-card">
        <div className="logo-container">
          <img src={logo} alt="Alyona Time Logo" className="logo" />
        </div>
        <h1 className="dashboard-title">
          {username === 'alyona' ? '👩' : '👨'} Привет, {username === 'alyona' ? 'Алёна' : 'Коля'}!
        </h1>
        <div className="status-indicator">
          <div className={`status-dot ${isConnected ? 'online' : 'offline'}`}></div>
          <span>{isConnected ? 'Подключено' : 'Подключение...'}</span>
        </div>
        <button
          className="call-button"
          onClick={handleJoinCall}
          disabled={!isConnected}
        >
          📞 Подключиться к звонку
        </button>
        <button
          className="logout-button"
          onClick={() => navigate('/')}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

export default Dashboard;

