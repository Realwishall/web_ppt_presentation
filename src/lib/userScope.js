// ─────────────────────────────────────────────────────────────────────────────
// EVERY DOCUMENT THIS APP WRITES LIVES UNDER ONE USER.
//
//   users/{uid}/classes/{classId}/chapters/{chapterId}/folders/{folderId}
//   users/{uid}/content/{code}/versions/{v}/parts/{i}
//   users/{uid}/batches/{batchId}/sessions/{sessionId}/chunks/{i}
//   users/{uid}/batches/{batchId}/meta/{settings|roster|sessionHistory}
//   users/{uid}/appSettings/{curriculum|exportPages|branding|shortcuts}
//
// Two teachers signing into the same deployment therefore see two completely
// separate libraries, batch lists, session histories and global settings.
// Isolation is enforced twice: here, because the uid is baked into every path,
// and again in firestore.rules, which refuses any path whose {uid} segment is
// not the caller's own. A bug in this file cannot leak data — the rules stop it.
//
// `uid()` reads Firebase's *current* user synchronously. Every caller sits
// behind <ProtectedRoute>, which does not render until auth has resolved, so
// by the time any of these run there is a user. The throw is a loud failure
// for the one case that would otherwise be silent and awful: a path built with
// `undefined` where the uid should be, which Firestore would happily accept as
// a document literally named "undefined" shared by everyone.
// ─────────────────────────────────────────────────────────────────────────────

import { collection, doc } from 'firebase/firestore'
import { auth, db } from '../firebase'

/** The signed-in user's id. Throws rather than building an unscoped path. */
export function uid() {
  const u = auth.currentUser?.uid
  if (!u) throw new Error('Not signed in — no user scope available.')
  return u
}

/** The same id, or null when nobody is signed in (for cache keys, not paths). */
export function uidOrNull() {
  return auth.currentUser?.uid || null
}

/** `users/{uid}` followed by whatever segments you pass. */
export function userPath(...segments) {
  return ['users', uid(), ...segments.filter((s) => s != null)]
}

/** A document under the current user: `udoc('classes', id)`. */
export function udoc(...segments) {
  return doc(db, ...userPath(...segments))
}

/** A collection under the current user: `ucol('classes')`. */
export function ucol(...segments) {
  return collection(db, ...userPath(...segments))
}
