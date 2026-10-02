// AHK Timer — configuration.

// ---------------------------------------------------------------------------
// Team sync (several devices share the same live race)
//
// Paste your Firebase web app config here to turn it on (README → Team sync).
// Leave it as null and races are saved on each device only.
// The config is not a secret: access is controlled by Firebase Authentication
// and the Firestore rules in firestore.rules.
export const FIREBASE = {
  apiKey: 'AIzaSyDbD7lncBnhPFq1cyRZBhWMJ9g9IitR3D4',
  authDomain: 'ahk-timer.firebaseapp.com',
  projectId: 'ahk-timer',
  storageBucket: 'ahk-timer.firebasestorage.app',
  messagingSenderId: '566748394889',
  appId: '1:566748394889:web:cd3fc4b0dff77b95e35d58',
};

// With team sync, people sign in with a short username: "pepa" signs in as
// pepa@<USERNAME_DOMAIN>. Create the accounts in Firebase with that domain.
// (Typing a full email address also works.) No email is ever sent to it.
export const USERNAME_DOMAIN = 'ahk-timer.app';

// ---------------------------------------------------------------------------
// Login without team sync (FIREBASE = null)
//
// Passwords are stored as SHA-256 hashes. To add a user or change a password,
// hash it in a terminal and paste the result below:
//
//   printf '%s' 'new-password' | shasum -a 256
//
// Note: without team sync this is a lightweight gate in front of the UI, not
// server-side security (see README → Login).
export const USERS = [
  { username: 'ahk', passwordSha256: 'c5f1d3d03ffcc0e9fddb9ef0c6ddc1a198997ea57abd42332d265489264e1a6c' },
];
