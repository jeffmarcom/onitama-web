import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Login from './pages/Login'
import Game from './pages/Game'
import Leaderboard from './pages/Leaderboard'
import HowToPlay from './pages/HowToPlay'

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'))
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (storedUser) {
      setUser(JSON.parse(storedUser))
    }
  }, [])

  const handleLogin = (newToken: string, newUser: any) => {
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
