// Copy this file to firebase-config.local.js and add your Firebase web-app values.
// Firebase web configuration is not a password. Firestore security rules protect data.
export const firebaseConfig = {
  apiKey: "AIzaSyCun3m2VXvjTDvvABKvqeCwf4SkbrrH1S8",
  authDomain: "driver-practice-database.firebaseapp.com",
  projectId: "driver-practice-database",
  appId: "1:314753925065:web:2cf741d08828dd64f8b218"
};

// An empty configuration intentionally starts the safe local-preview mode.
export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

