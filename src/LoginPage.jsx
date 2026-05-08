import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import './LoginPage.css'

export default function LoginPage() {
  const { user, loading, loginWithGoogle } = useAuth()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState(null)

  if (loading) {
    return (
      <div className="login-page">
        <div className="auth-loading">
          <div className="auth-loading__spinner" />
        </div>
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  const handleGoogleLogin = async () => {
    setIsSigningIn(true)
    setError(null)
    try {
      await loginWithGoogle()
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError('Something went wrong. Please try again.')
      }
      setIsSigningIn(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-ambient login-ambient--1" />
      <div className="login-ambient login-ambient--2" />
      <div className="login-ambient login-ambient--3" />

      <div className="login-card">
        <div className="login-card__header">
          <img
            src="/arcadia-icon.png"
            alt="Arcadia logo"
            className="login-card__logo"
            width="56"
            height="56"
          />
          <h1 className="login-card__title">arcadia</h1>
          <p className="login-card__subtitle">
            Collaborative canvas for your team
          </p>
        </div>

        <div className="login-card__body">
          <button
            type="button"
            className="login-google-btn"
            onClick={handleGoogleLogin}
            disabled={isSigningIn}
          >
            <svg className="login-google-btn__icon" viewBox="0 0 24 24" width="20" height="20">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            <span>{isSigningIn ? 'Signing in…' : 'Continue with Google'}</span>
          </button>

          {error && (
            <p className="login-card__error">{error}</p>
          )}
        </div>

        <div className="login-card__footer">
          <p>Draw together. Think better.</p>
        </div>
      </div>
    </div>
  )
}
