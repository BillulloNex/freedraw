import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { ref, set, get, serverTimestamp } from 'firebase/database'
import { auth, googleProvider, database } from './firebase'

const AuthContext = createContext(null)

const USERS_PATH = 'users'

// Curated palette for user colors
const USER_COLORS = [
  '#F86F54', '#537CF7', '#00A6A6', '#FF6B6B', '#4ECDC4',
  '#45B7D1', '#FFA07A', '#98D8C8', '#F7B731', '#5F27CD',
  '#00D2D3', '#FF9FF3', '#54A0FF', '#48DBFB', '#1DD1A1',
  '#F368E0', '#FF9F43',
]

function pickColor(uid) {
  let hash = 0
  for (let i = 0; i < uid.length; i++) {
    hash = uid.charCodeAt(i) + ((hash << 5) - hash)
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser)

        // Ensure user profile exists in RTDB
        const profileRef = ref(database, `${USERS_PATH}/${firebaseUser.uid}/profile`)
        const snapshot = await get(profileRef)

        if (snapshot.exists()) {
          const existing = snapshot.val()
          // Update last login and any changed Google profile info
          const updates = {
            ...existing,
            displayName: firebaseUser.displayName || existing.displayName,
            email: firebaseUser.email || existing.email,
            photoURL: firebaseUser.photoURL || existing.photoURL,
            lastLoginAt: serverTimestamp(),
          }
          await set(profileRef, updates)
          setUserProfile(updates)
        } else {
          // First-time user — create profile
          const newProfile = {
            displayName: firebaseUser.displayName || 'Anonymous',
            email: firebaseUser.email || '',
            photoURL: firebaseUser.photoURL || null,
            color: pickColor(firebaseUser.uid),
            avatarUrl: firebaseUser.photoURL || null,
            createdAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          }
          await set(profileRef, newProfile)
          setUserProfile(newProfile)
        }
      } else {
        setUser(null)
        setUserProfile(null)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error('Google sign-in error:', error)
      throw error
    }
  }

  const logout = async () => {
    try {
      await signOut(auth)
    } catch (error) {
      console.error('Sign-out error:', error)
      throw error
    }
  }

  const value = {
    user,
    userProfile,
    loading,
    loginWithGoogle,
    logout,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
