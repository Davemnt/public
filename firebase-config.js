/**
 * Firebase Configuration
 * 
 * MODO DEMO/LOCAL:
 * - Si dejás "DEMO_MODE", la app funciona SIN Firebase
 * - PIN de prueba: 1234
 * - Datos guardados en localStorage
 * 
 * MODO PRODUCCIÓN:
 * - Reemplazá "DEMO_MODE" con tu API key de Firebase
 * - Automáticamente cambia a Firebase + sincronización en la nube
 * 
 * Para obtener tu configuración de Firebase:
 * 1. Ir a https://console.firebase.google.com/
 * 2. Seleccionar tu proyecto
 * 3. Click en el ícono de engranaje ⚙️ → "Configuración del proyecto"
 * 4. Scroll hasta "Tus aplicaciones" → SDK snippet → Config
 * 5. Copiar todo el objeto firebaseConfig
 */

const firebaseConfig = {
  apiKey: "AIzaSyDROFsVQYi-UDEKQJKxakT-2oJZdFpBrTw",
  authDomain: "aurea-international-management.firebaseapp.com",
  projectId: "aurea-international-management",
  storageBucket: "aurea-international-management.firebasestorage.app",
  messagingSenderId: "708315838479",
  appId: "1:708315838479:web:f849b84c4458bab5064b7a"
};

window.firebaseConfig = firebaseConfig;

const isDemoMode = firebaseConfig.apiKey === "DEMO_MODE" || typeof window.firebase === 'undefined';

if (isDemoMode) {
  console.log('🔧 MODO DEMO ACTIVADO - PIN de prueba: 1234');
  console.log('📝 Firebase no se inicializó porque el SDK no está disponible o está en demo');
} else {
  try {
    window.firebase.initializeApp(firebaseConfig);
    window.auth = window.firebase.auth();
    window.db = window.firebase.firestore();

    if (window.auth && window.auth.setPersistence) {
      window.auth.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL);
    }

    console.log('🔥 Firebase inicializado correctamente');
  } catch (error) {
    console.error('❌ Error inicializando Firebase:', error);
    window.isDemoMode = true;
  }
}

window.isDemoMode = isDemoMode;
