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
  apiKey: "DEMO_MODE",  // ← Reemplazá con tu API key para activar Firebase
  authDomain: "tu-proyecto.firebaseapp.com",
  projectId: "tu-proyecto",
  storageBucket: "tu-proyecto.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};

// Detectar si está en modo DEMO o PRODUCCIÓN
const isDemoMode = firebaseConfig.apiKey === "DEMO_MODE";

if (isDemoMode) {
  console.log('🔧 MODO DEMO ACTIVADO - PIN de prueba: 1234');
  console.log('📝 Para activar Firebase, editá firebase-config.js con tu configuración real');
} else {
  // Inicializar Firebase solo en modo producción
  firebase.initializeApp(firebaseConfig);
  
  // Exportar servicios
  window.auth = firebase.auth();
  window.db = firebase.firestore();
  
  // Configurar persistencia (mantener sesión)
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  
  console.log('🔥 Firebase inicializado correctamente');
}

// Exportar flag de modo demo
window.isDemoMode = isDemoMode;
