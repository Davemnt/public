/**
 * Auth.js - Sistema de autenticación con PIN + Email
 * 
 * FUNCIONALIDADES:
 * - Registro: Email + PIN (4-6 dígitos)
 * - Login: Solo PIN (rápido como cajero)
 * - Recuperación: Por email si olvidaste el PIN
 * - Seguridad: PIN hasheado, protección anti-inspección
 * 
 * MODO DEMO/LOCAL:
 * - Si firebase-config.js está en DEMO_MODE, usa PIN hardcodeado: 1234
 * - Los datos se guardan en localStorage (sin Firebase)
 * - Perfecto para desarrollo y pruebas locales
 */

const Auth = (() => {
  
  // ========================================
  // FUNCIONES MODO DEMO (SIN FIREBASE)
  // ========================================
  
  const DEMO_PIN = '1234';
  const DEMO_EMAIL = 'demo@aurea.local';
  
  /**
   * Login en modo DEMO - PIN hardcodeado: 1234
   */
  async function loginWithPINDemo(pin) {
    const savedPin = localStorage.getItem('aurea_demo_custom_pin') || DEMO_PIN;
    if (pin === savedPin) {
      // Simular usuario autenticado
      const demoUser = {
        uid: 'demo-user-local',
        email: DEMO_EMAIL,
        displayName: 'Usuario Demo'
      };
      
      // Usar sessionStorage en modo demo para exigir login al abrir una nueva sesión
      sessionStorage.setItem('aurea_demo_user', JSON.stringify(demoUser));
      sessionStorage.setItem('aurea_user_email', DEMO_EMAIL);
      
      console.log('✅ Login DEMO exitoso');
      return demoUser;
    } else {
      const fallbackPin = localStorage.getItem('aurea_demo_custom_pin') ? 'El PIN actual es incorrecto' : 'PIN incorrecto. PIN de prueba: 1234';
      throw new Error(fallbackPin);
    }
  }
  
  /**
   * Registro en modo DEMO - Guarda email pero usa PIN hardcodeado
   */
  async function registerDemo(email, pin) {
    if (!email || !email.includes('@')) {
      throw new Error('Email inválido');
    }
    
    const demoUser = {
      uid: 'demo-user-local',
      email: email,
      displayName: 'Usuario Demo'
    };
    
    // Guardar en sessionStorage para que el demo no recuerde la sesión indefinidamente
    sessionStorage.setItem('aurea_demo_user', JSON.stringify(demoUser));
    sessionStorage.setItem('aurea_user_email', email);
    
    console.log('✅ Registro DEMO exitoso');
    console.log('📌 IMPORTANTE: En modo DEMO el PIN es siempre: 1234');
    
    return demoUser;
  }
  
  /**
   * Logout en modo DEMO
   */
  function logoutDemo() {
    sessionStorage.removeItem('aurea_demo_user');
    console.log('✅ Sesión DEMO cerrada');
    window.location.reload();
  }
  
  /**
   * Verificar autenticación en modo DEMO
   */
  function isAuthenticatedDemo() {
    return !!sessionStorage.getItem('aurea_demo_user');
  }
  
  /**
   * Obtener usuario actual en modo DEMO
   */
  function getCurrentUserDemo() {
    const userJson = sessionStorage.getItem('aurea_demo_user');
    return userJson ? JSON.parse(userJson) : null;
  }
  
  /**
   * Obtener ID de usuario en modo DEMO
   */
  function getUserIdDemo() {
    return 'demo-user-local';
  }
  
  /**
   * Listener de cambios de autenticación en modo DEMO
   */
  function onAuthStateChangedDemo(callback) {
    // Simular callback inmediato
    const user = getCurrentUserDemo();
    setTimeout(() => callback(user), 100);
    
    // Retornar función de unsuscribe (vacía en demo)
    return () => {};
  }
  
  // ========================================
  // PROTECCIÓN ANTI-INSPECCIÓN
  // ========================================
  
  /**
   * Deshabilita DevTools y click derecho
   * IMPORTANTE: Se ejecuta automáticamente al cargar
  // ========================================
  // PROTECCIÓN ANTI-INSPECCIÓN
  // ========================================
  
  /**
   * Permite inspección temporal durante 5 minutos
   * Para usar: Ejecuta en la consola (desde otra pestaña):
   * 
   * localStorage.setItem('aurea_allow_devtools', Date.now() + 300000)
   * 
   * Luego recarga la página y podrás usar DevTools normalmente
   */
  function isDevToolsAllowed() {
    const allowed = localStorage.getItem('aurea_allow_devtools');
    if (allowed && parseInt(allowed) > Date.now()) {
      return true;
    }
    // Limpiar si expiró
    if (allowed) {
      localStorage.removeItem('aurea_allow_devtools');
    }
    return false;
  }
  
  /**
   * Función de seguridad anti-inspección
   * NOTA: Para permitir inspección temporal, usa allowDevTools()
   */
  function enableAntiInspection() {
    // Si está permitido temporalmente, no activar protección
    if (isDevToolsAllowed()) {
      console.log('🔓 DevTools habilitado temporalmente (5 min)');
      return;
    }
    
    // Bloquear F12, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+U
    document.addEventListener('keydown', (e) => {
      if (
        e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
        (e.ctrlKey && e.key === 'U')
      ) {
        e.preventDefault();
        console.warn('⚠️ DevTools deshabilitado por seguridad');
        return false;
      }
    });
    
    // Bloquear click derecho
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });
    
    // Detectar si DevTools está abierto
    let devtoolsOpen = false;
    const element = new Image();
    Object.defineProperty(element, 'id', {
      get: function() {
        devtoolsOpen = true;
        logout(); // Cerrar sesión si se detecta inspección
        throw new Error('⚠️ Inspección detectada. Sesión cerrada por seguridad.');
      }
    });
    
    setInterval(() => {
      devtoolsOpen = false;
      console.log(element);
      console.clear();
    }, 1000);
    
    // Detectar manipulación del DOM
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.target.id === 'login-screen') {
          // Si intentan ocultar la pantalla de login manualmente
          if (mutation.target.style.display === 'none' && !Auth.isAuthenticated()) {
            mutation.target.style.display = 'flex';
            console.warn('⚠️ Intento de bypass detectado');
          }
        }
      });
    });
    
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) {
      observer.observe(loginScreen, { attributes: true, attributeFilter: ['style'] });
    }
  }
  
  // ========================================
  // HASH DE PIN (SEGURIDAD)
  // ========================================
  
  /**
   * Hashea el PIN usando SHA-256
   * IMPORTANTE: El PIN nunca se guarda en texto plano
   */
  async function hashPIN(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }
  
  // ========================================
  // REGISTRO
  // ========================================
  
  /**
   * Registra un nuevo usuario con Email + PIN
   * 
   * @param {string} email - Email del usuario
   * @param {string} pin - PIN de 4-6 dígitos
   * @returns {Promise<Object>} - Usuario creado
   */
  async function register(email, pin) {
    // MODO DEMO: Usar función simplificada
    if (window.isDemoMode) {
      return await registerDemo(email, pin);
    }
    
    // MODO PRODUCCIÓN: Usar Firebase
    try {
      // Validaciones
      if (!email || !email.includes('@')) {
        throw new Error('Email inválido');
      }
      
      if (!pin || pin.length < 4 || pin.length > 6) {
        throw new Error('El PIN debe tener entre 4 y 6 dígitos');
      }
      
      if (!/^\d+$/.test(pin)) {
        throw new Error('El PIN solo puede contener números');
      }
      
      // Hashear PIN
      const hashedPIN = await hashPIN(pin);
      
      // Crear usuario en Firebase Auth (usando el PIN como contraseña temporal)
      // NOTA: Firebase requiere contraseña de mín 6 caracteres
      const tempPassword = hashedPIN.substring(0, 20); // Usar parte del hash
      
      const userCredential = await auth.createUserWithEmailAndPassword(email, tempPassword);
      const user = userCredential.user;
      
      // Guardar PIN hasheado en Firestore
      await db.collection('users').doc(user.uid).set({
        email: email,
        pinHash: hashedPIN,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      // Crear documento de configuración inicial
      await db.collection('users').doc(user.uid).collection('config').doc('company').set({
        companyName: '',
        address: '',
        email: email,
        phone: '',
        taxId: '',
        logo: ''
      });
      
      console.log('✅ Usuario registrado:', email);
      return user;
      
    } catch (error) {
      console.error('❌ Error en registro:', error);
      throw error;
    }
  }
  
  // ========================================
  // LOGIN CON PIN
  // ========================================
  
  /**
   * Login rápido con PIN (solo dígitos)
   * IMPORTANTE: No requiere email, solo el PIN
   * 
   * @param {string} pin - PIN del usuario
   * @returns {Promise<Object>} - Usuario autenticado
   */
  async function loginWithPIN(pin) {
    // MODO DEMO: PIN hardcodeado 1234
    if (window.isDemoMode) {
      return await loginWithPINDemo(pin);
    }
    
    // MODO PRODUCCIÓN: Usar Firebase
    try {
      // Validar PIN
      if (!pin || pin.length < 4 || pin.length > 6) {
        throw new Error('PIN inválido');
      }
      
      // Hashear PIN ingresado
      const hashedPIN = await hashPIN(pin);
      
      // Obtener el usuario actual (debe estar guardado en localStorage)
      const savedEmail = localStorage.getItem('aurea_user_email');
      
      if (!savedEmail) {
        throw new Error('No hay usuario registrado. Por favor, registrate primero.');
      }
      
      // Buscar el usuario en Firestore
      const userSnapshot = await db.collection('users')
        .where('email', '==', savedEmail)
        .limit(1)
        .get();
      
      if (userSnapshot.empty) {
        throw new Error('Usuario no encontrado');
      }
      
      const userData = userSnapshot.docs[0].data();
      
      // Verificar PIN
      if (userData.pinHash !== hashedPIN) {
        throw new Error('PIN incorrecto');
      }
      
      // Login con Firebase Auth (usando el hash como contraseña)
      const tempPassword = hashedPIN.substring(0, 20);
      const userCredential = await auth.signInWithEmailAndPassword(savedEmail, tempPassword);
      
      // Actualizar último login
      await db.collection('users').doc(userCredential.user.uid).update({
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ Login exitoso');
      return userCredential.user;
      
    } catch (error) {
      console.error('❌ Error en login:', error);
      throw error;
    }
  }
  
  // ========================================
  // LOGIN CON EMAIL (RECUPERACIÓN)
  // ========================================
  
  /**
   * Login con Email + PIN (usado para recuperación)
   * 
   * @param {string} email - Email del usuario
   * @param {string} pin - PIN del usuario
   * @returns {Promise<Object>} - Usuario autenticado
   */
  async function loginWithEmail(email, pin) {
    try {
      const hashedPIN = await hashPIN(pin);
      const tempPassword = hashedPIN.substring(0, 20);
      
      const userCredential = await auth.signInWithEmailAndPassword(email, tempPassword);
      
      // Guardar email para próximos logins con PIN
      localStorage.setItem('aurea_user_email', email);
      
      // Actualizar último login
      await db.collection('users').doc(userCredential.user.uid).update({
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ Login con email exitoso');
      return userCredential.user;
      
    } catch (error) {
      console.error('❌ Error en login con email:', error);
      throw error;
    }
  }
  
  // ========================================
  // RECUPERAR PIN
  // ========================================
  
  /**
   * Envía email de recuperación para cambiar el PIN
   * 
   * @param {string} email - Email del usuario
   */
  async function sendPasswordReset(email) {
    try {
      await auth.sendPasswordResetEmail(email);
      console.log('✅ Email de recuperación enviado');
    } catch (error) {
      console.error('❌ Error enviando email:', error);
      throw error;
    }
  }
  
  /**
   * Cambia el PIN del usuario
   * 
   * @param {string} newPIN - Nuevo PIN
   */
  async function changePIN(newPIN, currentPIN = null) {
    try {
      if (window.isDemoMode) {
        const pinToValidate = currentPIN ?? DEMO_PIN;
        const storedPin = localStorage.getItem('aurea_demo_custom_pin') || DEMO_PIN;
        if (String(pinToValidate) !== String(storedPin)) {
          throw new Error('El PIN actual es incorrecto');
        }

        if (!newPIN || newPIN.length < 4 || newPIN.length > 6) {
          throw new Error('El PIN debe tener entre 4 y 6 dígitos');
        }

        if (!/^\d+$/.test(newPIN)) {
          throw new Error('El PIN solo puede contener números');
        }

        localStorage.setItem('aurea_demo_custom_pin', String(newPIN));
        console.log('✅ PIN demo cambiado exitosamente');
        return true;
      }

      const user = auth.currentUser;
      
      if (!user) {
        throw new Error('No hay usuario autenticado');
      }
      
      // Validar nuevo PIN
      if (!newPIN || newPIN.length < 4 || newPIN.length > 6) {
        throw new Error('El PIN debe tener entre 4 y 6 dígitos');
      }
      
      if (!/^\d+$/.test(newPIN)) {
        throw new Error('El PIN solo puede contener números');
      }
      
      // Hashear nuevo PIN
      const hashedPIN = await hashPIN(newPIN);
      const tempPassword = hashedPIN.substring(0, 20);
      
      // Actualizar contraseña en Auth
      await user.updatePassword(tempPassword);
      
      // Actualizar PIN en Firestore
      await db.collection('users').doc(user.uid).update({
        pinHash: hashedPIN,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      console.log('✅ PIN cambiado exitosamente');
      return true;
      
    } catch (error) {
      console.error('❌ Error cambiando PIN:', error);
      throw error;
    }
  }
  
  // ========================================
  // LOGOUT
  // ========================================
  
  /**
   * Cierra la sesión del usuario
   */
  async function logout() {
    // MODO DEMO
    if (window.isDemoMode) {
      return logoutDemo();
    }
    
    // MODO PRODUCCIÓN
    try {
      await auth.signOut();
      console.log('✅ Sesión cerrada');
      window.location.reload();
    } catch (error) {
      console.error('❌ Error cerrando sesión:', error);
    }
  }
  
  // ========================================
  // ESTADO DE AUTENTICACIÓN
  // ========================================
  
  /**
   * Verifica si hay un usuario autenticado
   * @returns {boolean}
   */
  function isAuthenticated() {
    if (window.isDemoMode) {
      return isAuthenticatedDemo();
    }
    return !!auth.currentUser;
  }
  
  /**
   * Obtiene el usuario actual
   * @returns {Object|null}
   */
  function getCurrentUser() {
    if (window.isDemoMode) {
      return getCurrentUserDemo();
    }
    return auth.currentUser;
  }
  
  /**
   * Obtiene el UID del usuario actual
   * @returns {string|null}
   */
  function getUserId() {
    if (window.isDemoMode) {
      return getUserIdDemo();
    }
    return auth.currentUser ? auth.currentUser.uid : null;
  }
  
  /**
   * Listener de cambios en autenticación
   * @param {Function} callback - Función que recibe el usuario o null
   */
  function onAuthStateChanged(callback) {
    if (window.isDemoMode) {
      return onAuthStateChangedDemo(callback);
    }
    return auth.onAuthStateChanged(callback);
  }
  
  // ========================================
  // MIGRACIÓN DE DATOS LOCALES
  // ========================================
  
  /**
   * Migra datos de localStorage a Firestore
   * IMPORTANTE: Se ejecuta solo una vez, después del primer login
   */
  async function migrateLocalData() {
    try {
      const userId = getUserId();
      if (!userId) return;
      
      // Verificar si ya se migró
      const migrationFlag = localStorage.getItem('aurea_migrated');
      if (migrationFlag === 'true') {
        console.log('ℹ️ Datos ya migrados anteriormente');
        return;
      }
      
      // Colecciones a migrar
      const collections = ['budgets', 'projects', 'incomes', 'expenses', 'operations', 'invoices'];
      
      let totalMigrated = 0;
      
      for (const collectionName of collections) {
        const data = localStorage.getItem(`aurea2_${collectionName}`);
        
        if (data) {
          const items = JSON.parse(data);
          
          if (Array.isArray(items) && items.length > 0) {
            const batch = db.batch();
            
            items.forEach(item => {
              const docRef = db.collection('users').doc(userId).collection(collectionName).doc(item.id);
              batch.set(docRef, item);
            });
            
            await batch.commit();
            totalMigrated += items.length;
            console.log(`✅ Migrados ${items.length} ${collectionName}`);
          }
        }
      }
      
      // Migrar configuración
      const configData = localStorage.getItem('aurea2_config');
      if (configData) {
        const config = JSON.parse(configData);
        await db.collection('users').doc(userId).collection('config').doc('company').set(config);
        console.log('✅ Configuración migrada');
      }
      
      // Marcar como migrado
      localStorage.setItem('aurea_migrated', 'true');
      
      if (totalMigrated > 0) {
        alert(`✅ Se migraron ${totalMigrated} registros a Firebase exitosamente`);
      }
      
    } catch (error) {
      console.error('❌ Error migrando datos:', error);
    }
  }
  
  // ========================================
  // INICIALIZACIÓN
  // ========================================
  
  // En entornos locales (localhost / 127.0.0.1) permitir DevTools automáticamente
  try {
    const host = (window.location && window.location.hostname) || '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '') {
      // Habilitar DevTools temporalmente (5 minutos)
      localStorage.setItem('aurea_allow_devtools', String(Date.now() + 300000));
      console.log('🔓 DevTools auto-habilitado en entorno local');
    }
  } catch (e) {
    console.warn('No se pudo auto-habilitar DevTools:', e);
  }

  // Activar protección anti-inspección
  enableAntiInspection();
  
  // ========================================
  // EXPORTAR API
  // ========================================
  
  return {
    register,
    loginWithPIN,
    loginWithEmail,
    sendPasswordReset,
    changePIN,
    logout,
    isAuthenticated,
    getCurrentUser,
    getUserId,
    onAuthStateChanged,
    migrateLocalData
  };
  
})();

// ========================================
// FUNCIÓN GLOBAL: PERMITIR DEVTOOLS
// ========================================

/**
 * Permite inspección temporal durante 5 minutos
 * 
 * USO:
 * 1. Abre la consola desde otra pestaña (para no activar la protección)
 * 2. Ejecuta: allowDevTools()
 * 3. Recarga la página
 * 4. Ya puedes usar F12, click derecho, etc. por 5 minutos
 * 
 * ALTERNATIVA SIN CONSOLA:
 * 1. Copia esta URL en tu navegador:
 *    javascript:localStorage.setItem('aurea_allow_devtools',Date.now()+300000);alert('DevTools habilitado! Recarga la página');
 * 2. Recarga la página
 */
window.allowDevTools = function() {
  const expiresAt = Date.now() + 300000; // 5 minutos
  localStorage.setItem('aurea_allow_devtools', expiresAt);
  console.log('✅ DevTools habilitado por 5 minutos');
  console.log('🔄 Recarga la página para aplicar los cambios');
  console.log('⏰ Expira:', new Date(expiresAt).toLocaleTimeString());
  return 'Recarga la página para usar DevTools';
};

// Mostrar ayuda al cargar
if (localStorage.getItem('aurea_allow_devtools')) {
  const expires = parseInt(localStorage.getItem('aurea_allow_devtools'));
  if (expires > Date.now()) {
    console.log('🔓 DevTools HABILITADO hasta:', new Date(expires).toLocaleTimeString());
  }
} else {
  console.log('💡 Para habilitar DevTools temporalmente, ejecuta: allowDevTools()');
}
