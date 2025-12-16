// firebase.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Tu configuración (la que ya tienes)
const firebaseConfig = {
  apiKey: 'AIzaSyCZ-B1ZzduZ_Y5tfDeDOyTZ_SlydSaKkmA',
  authDomain: 'canto-del-bosque-pos.firebaseapp.com',
  projectId: 'canto-del-bosque-pos',
  storageBucket: 'canto-del-bosque-pos.firebasestorage.app',
  messagingSenderId: '265366570796',
  appId: '1:265366570796:web:4953c7181ba81bb5cb4e89',
  measurementId: 'G-WG636JBY28',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

// Iniciar sesión anónimo para identificar dispositivos (útil para auditoría)
signInAnonymously(auth).catch((err) => {
  console.warn('No se pudo iniciar sesión anónimo:', err.message);
});

export { app, db, auth, storage };
