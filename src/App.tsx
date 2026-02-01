import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState } from 'react'
import Login from './pages/Login'
import Game from './pages/Game'
import Lobby from './pages/Lobby'
import Leaderboard from './pages/Leaderboard'
import HowToPlay from './pages/HowToPlay'

export interface User {
  username: string
}

function getInitialUser(): User | null {
  try {
    const stored = localStorage.getItem('user')
    if (!stored) return null
    return JSON.parse(stored) as User
  } catch {
    return null
  }
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(getInitialUser())

  const handleLogin = (newToken: string, newUser: User) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('token', newToken)
    localStorage.setItem('user', JSON.stringify(newUser))
  }

  const handleLogout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route 
          path="/login" 
          element={
            token ? <Navigate to="/game" /> : <Login onLogin={handleLogin} />
          } 
        />
        <Route 
          path="/game" 
          element={
            token ? <Game token={token} user={user} onLogout={handleLogout} /> : <Navigate to="/login" />
          } 
        />
        <Route 
          path="/lobby" 
          element={
            token ? <Lobby token={token} onLogout={handleLogout} /> : <Navigate to="/login" />
          } 
        />
        <Route 
          path="/leaderboard" 
          element={<Leaderboard token={token} onLogout={handleLogout} />} 
        />
        <Route 
          path="/how-to-play" 
          element={token ? <HowToPlay onLogout={handleLogout} /> : <Navigate to="/login" />} 
        />
        <Route path="/" element={<Navigate to={token ? "/game" : "/login"} />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
