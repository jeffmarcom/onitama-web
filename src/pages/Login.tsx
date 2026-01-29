import { useState } from 'react'

interface LoginProps {
  onLogin: (token: string, user: any) => void
}

function Login({ onLogin }: LoginProps) {
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Authentication failed')
      }

      onLogin(data.token, data.user)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>ONITAMA</h1>
        {error && <div className="error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <button type="submit" className="btn" disabled={loading}>
            {loading ? 'Loading...' : (isRegister ? 'Register' : 'Login')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsRegister(!isRegister)}
          >
            {isRegister ? 'Switch to Login' : 'Switch to Register'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
