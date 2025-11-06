import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logo from '../img/logopng.png';
import './Login.css';

const ALLOWED_USERS = ['alyona', 'kolia'];

function Login() {
  const [selectedUser, setSelectedUser] = useState('');
  const navigate = useNavigate();

  const handleLogin = (username) => {
    if (ALLOWED_USERS.includes(username)) {
      navigate(`/dashboard/${username}`);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="logo-container">
          <img src={logo} alt="Alyona Time Logo" className="logo" />
        </div>
        <h1 className="login-title">Alyona Time</h1>
        <p className="login-subtitle">Выберите пользователя</p>
        <div className="user-buttons">
          <button
            className={`user-button ${selectedUser === 'alyona' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedUser('alyona');
              handleLogin('alyona');
            }}
          >
            👩 Алёна
          </button>
          <button
            className={`user-button ${selectedUser === 'kolia' ? 'selected' : ''}`}
            onClick={() => {
              setSelectedUser('kolia');
              handleLogin('kolia');
            }}
          >
            👨 Коля
          </button>
        </div>
      </div>
    </div>
  );
}

export default Login;

