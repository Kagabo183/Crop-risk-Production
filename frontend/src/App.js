import React, { useState } from 'react';

import './App.css';

import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MainContent from './components/MainContent';
import Login from './pages/Login';
import { API_BASE } from './api';
import { BrowserRouter as Router } from 'react-router-dom';


function App() {
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loginError, setLoginError] = useState(null);

  const handleLogin = async (username, password) => {
    setLoginError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username,
          password
        })
      });
      if (!res.ok) {
        throw new Error('Invalid credentials');
      }
      const data = await res.json();
      setToken(data.access_token);
      localStorage.setItem('token', data.access_token);
    } catch (err) {
      setLoginError(err.message);
    }
  };

  const handleLogout = () => {
    setToken(null);
    localStorage.removeItem('token');
  };

  if (!token) {
    return <Login onLogin={handleLogin} error={loginError} />;
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="App">
        <Sidebar />
        <Header />
        <button onClick={handleLogout} style={{position:'absolute',top:16,right:16}}>Logout</button>
        <MainContent />
      </div>
    </Router>
  );
}

export default App;
