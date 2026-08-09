import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth'
import { auth } from '../firebase'

const AuthContext = createContext(null)

// Who is signed in, and the three things the app does about it.
//
// There is no admin tier any more: every account owns its own classes,
// content, batches and settings under `users/{uid}` (see lib/userScope.js), so
// there is nothing one account could usefully be privileged over in another's.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsub
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      login: (email, password) => signInWithEmailAndPassword(auth, email, password),
      /**
       * A brand-new account. Nothing is written to Firestore here: the first
       * class, batch or setting the teacher creates brings `users/{uid}` into
       * existence on its own, so an abandoned sign-up leaves no empty shell.
       */
      signup: async (email, password, displayName) => {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        const name = (displayName || '').trim()
        if (name) {
          await updateProfile(cred.user, { displayName: name }).catch(() => {})
        }
        return cred
      },
      logout: () => signOut(auth),
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
