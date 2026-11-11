/* ==========================================================================
 * js/core/firebase-imports.js
 * Firebase SDK functions (the SDK itself is imported once in js/loader.js and exposed as window.FB)
 * Loaded by js/loader.js (load order lives in js/manifest.js).
 * All js files share one global scope, so functions/consts here are visible to the others.
 * ========================================================================== */
'use strict';

const {initializeApp}=window.FB;
const {initializeAuth,indexedDBLocalPersistence,browserLocalPersistence:_bLP,browserSessionPersistence,inMemoryPersistence,browserPopupRedirectResolver,onAuthStateChanged,createUserWithEmailAndPassword,signInWithEmailAndPassword,signInWithPopup,GoogleAuthProvider,signOut:fbSignOut,sendEmailVerification,sendPasswordResetEmail,deleteUser,linkWithCredential,EmailAuthProvider,setPersistence,browserLocalPersistence,
  /* v54 security: a real password CHANGE needs both of these. updatePassword alone is refused
     by Firebase when the sign-in is not recent, so the current password is used to
     reauthenticate first - which is also the only way to prove it is really this person at a
     keyboard, since these accounts have no email to send a reset link to. */
  updatePassword,reauthenticateWithCredential,
  /* v54.1 privacy: accounts whose Auth email is a REAL address can no longer have that address
     published in the public username->email map. For those, /api/login verifies the password
     server-side and hands back a custom token, so the browser is never told the address.
     Optional: with /api/login not deployed, those people sign in with their email as before. */
  signInWithCustomToken}=window.FB;
const {initializeAppCheck,ReCaptchaEnterpriseProvider}=window.FB;
const {getDatabase,ref,onValue,get,set,update,remove,push,runTransaction,query,orderByChild,orderByValue,equalTo,limitToLast,limitToFirst,endAt,serverTimestamp,onDisconnect,enableLogging}=window.FB;
