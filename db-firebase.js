/**
 * Aurea DB — Capa de datos con Firebase Firestore
 * CRUD genérico + helpers para consultas comunes + Sincronización en tiempo real
 * 
 * MODO DEMO/LOCAL:
 * - Si firebase-config.js está en DEMO_MODE, usa localStorage
 * - Perfecto para desarrollo sin necesidad de configurar Firebase
 * - Cuando configures Firebase, automáticamente cambia a sincronización en la nube
 * 
 * GUÍA RÁPIDA:
 * - Todo se guarda en Firebase Firestore (backend en la nube) o localStorage (modo demo)
 * - Cada colección es una subcolección del usuario autenticado
 * - Sincronización automática en tiempo real (solo en modo Firebase)
 * 
 * ESTRUCTURA EN FIRESTORE:
 * users/
 *   {userId}/
 *     budgets/
 *       {budgetId}: { projectName, client, ... }
 *     projects/
 *       {projectId}: { name, status, ... }
 *     incomes/
 *       {incomeId}: { projectId, amount, ... }
 *     ... etc
 * 
 * USO (igual que antes):
 * DB.getAll('budgets')           // Obtener todos los presupuestos
 * DB.get('budgets', id)          // Obtener presupuesto por ID
 * DB.add('budgets', {...})       // Crear presupuesto nuevo (sincroniza automáticamente)
 * DB.update('budgets', id, {...}) // Actualizar presupuesto (sincroniza automáticamente)
 * DB.remove('budgets', id)       // Eliminar presupuesto (sincroniza automáticamente)
 * 
 * IMPORTANTE: Requiere usuario autenticado (Auth.getUserId())
 */
const DB = (() => {
  'use strict';
  
  // ========================================
  // FUNCIONES MODO DEMO (LOCALSTORAGE)
  // ========================================
  
  /**
   * Obtiene datos de localStorage en modo DEMO
   */
  function _getLocalStorage(col) {
    const data = localStorage.getItem(`aurea2_${col}`);
    return data ? JSON.parse(data) : [];
  }
  
  /**
   * Guarda datos en localStorage en modo DEMO
   */
  function _setLocalStorage(col, data) {
    localStorage.setItem(`aurea2_${col}`, JSON.stringify(data));
  }
  
  /**
   * ADD en modo DEMO
   */
  function addDemo(col, item) {
    const data = _getLocalStorage(col);
    const newItem = { ...item, id: _id() };
    data.push(newItem);
    _setLocalStorage(col, data);
    return newItem;
  }
  
  /**
   * UPDATE en modo DEMO
   */
  function updateDemo(col, id, updates) {
    const data = _getLocalStorage(col);
    const index = data.findIndex(item => item.id === id);
    if (index !== -1) {
      data[index] = { ...data[index], ...updates };
      _setLocalStorage(col, data);
      return data[index];
    }
    return null;
  }
  
  /**
   * REMOVE en modo DEMO
   */
  function removeDemo(col, id) {
    let data = _getLocalStorage(col);
    data = data.filter(item => item.id !== id);
    _setLocalStorage(col, data);
  }
  
  /**
   * GET ALL en modo DEMO
   */
  function getAllDemo(col) {
    return _getLocalStorage(col);
  }
  
  /**
   * GET por ID en modo DEMO
   */
  function getDemo(col, id) {
    const data = _getLocalStorage(col);
    return data.find(item => item.id === id) || null;
  }
  
  /**
   * CONFIG en modo DEMO
   */
  function getConfigDemo() {
    const config = localStorage.getItem('aurea2_config');
    return config ? JSON.parse(config) : null;
  }
  
  function setConfigDemo(data) {
    localStorage.setItem('aurea2_config', JSON.stringify(data));
  }
  
  /**
   * CONTADORES en modo DEMO
   */
  function nextNumberDemo(key) {
    const counters = localStorage.getItem('aurea2_counters');
    const data = counters ? JSON.parse(counters) : {};
    const current = data[key] || 0;
    const next = current + 1;
    data[key] = next;
    localStorage.setItem('aurea2_counters', JSON.stringify(data));
    return next;
  }
  
  function nextBudgetNumberDemo() {
    const counters = localStorage.getItem('aurea2_budget_counters');
    const data = counters ? JSON.parse(counters) : {};
    
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateKey = `${yy}${mm}${dd}`;
    
    const current = data[dateKey] || 0;
    const next = current + 1;
    data[dateKey] = next;
    
    localStorage.setItem('aurea2_budget_counters', JSON.stringify(data));
    
    return `${yy}${mm}${dd}${String(next).padStart(3, '0')}`;
  }
  
  // ========================================
  // CACHE Y LISTENERS (MODO FIREBASE)
  // ========================================
  
  // Cache local para consultas rápidas
  const cache = {
    budgets: [],
    projects: [],
    incomes: [],
    expenses: [],
    operations: [],
    invoices: [],
    config: null
  };
  
  // Listeners activos
  const listeners = {};
  
  // ========================================
  // HELPERS INTERNOS
  // ========================================
  
  /**
   * Obtiene el UID del usuario actual
   */
  function _getUserId() {
    const userId = Auth.getUserId();
    if (!userId) {
      throw new Error('No hay usuario autenticado');
    }
    return userId;
  }
  
  /**
   * Obtiene la referencia de una colección del usuario
   */
  function _getCollection(col) {
    const userId = _getUserId();
    return db.collection('users').doc(userId).collection(col);
  }
  
  /**
   * Genera un ID único
   */
  function _id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  
  /**
   * Inicia listener de tiempo real para una colección
   * IMPORTANTE: Se ejecuta automáticamente en init()
   */
  function _startListener(col) {
    if (listeners[col]) return; // Ya existe
    
    const collectionRef = _getCollection(col);
    
    listeners[col] = collectionRef.onSnapshot(
      (snapshot) => {
        const data = [];
        snapshot.forEach(doc => {
          data.push({ id: doc.id, ...doc.data() });
        });
        cache[col] = data;
        
        // Disparar evento personalizado para que app.js reaccione
        window.dispatchEvent(new CustomEvent('db-updated', { 
          detail: { collection: col, data } 
        }));
      },
      (error) => {
        console.error(`Error en listener de ${col}:`, error);
      }
    );
  }
  
  /**
   * Inicia listener para la configuración
   */
  function _startConfigListener() {
    const userId = _getUserId();
    const configRef = db.collection('users').doc(userId).collection('config').doc('company');
    
    listeners['config'] = configRef.onSnapshot(
      (doc) => {
        cache.config = doc.exists ? doc.data() : null;
        window.dispatchEvent(new CustomEvent('db-updated', { 
          detail: { collection: 'config', data: cache.config } 
        }));
      },
      (error) => {
        console.error('Error en listener de config:', error);
      }
    );
  }
  
  // ========================================
  // CRUD GENÉRICO
  // ========================================
  
  /**
   * getAll - Obtiene todos los documentos de una colección
   * IMPORTANTE: Devuelve desde cache (actualizado en tiempo real)
   */
  function getAll(col) {
    // MODO DEMO: Leer desde localStorage
    if (window.isDemoMode) {
      return getAllDemo(col);
    }
    
    // MODO PRODUCCIÓN: Leer desde cache
    return cache[col] || [];
  }
  
  /**
   * get - Obtiene un documento por ID
   */
  function get(col, id) {
    // MODO DEMO: Buscar en localStorage
    if (window.isDemoMode) {
      return getDemo(col, id);
    }
    
    // MODO PRODUCCIÓN: Buscar en cache
    const items = cache[col] || [];
    return items.find(r => r.id === id) || null;
  }
  
  /**
   * add - Crea un nuevo documento
   * IMPORTANTE: Sincroniza automáticamente con Firestore
   */
  async function add(col, data) {
    // MODO DEMO: Usar localStorage
    if (window.isDemoMode) {
      return addDemo(col, data);
    }
    
    // MODO PRODUCCIÓN: Usar Firestore
    try {
      const collectionRef = _getCollection(col);
      
      const docData = {
        ...data,
        createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp()
      };
      
      // Si no tiene ID, usar ID generado por Firestore
      if (data.id) {
        await collectionRef.doc(data.id).set(docData);
        return { id: data.id, ...docData };
      } else {
        const docRef = await collectionRef.add(docData);
        return { id: docRef.id, ...docData };
      }
      
    } catch (error) {
      console.error(`Error añadiendo a ${col}:`, error);
      throw error;
    }
  }
  
  /**
   * update - Actualiza un documento existente
   * IMPORTANTE: Sincroniza automáticamente con Firestore
   */
  async function update(col, id, data) {
    // MODO DEMO: Usar localStorage
    if (window.isDemoMode) {
      return updateDemo(col, id, data);
    }
    
    // MODO PRODUCCIÓN: Usar Firestore
    try {
      const collectionRef = _getCollection(col);
      
      const updateData = {
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      await collectionRef.doc(id).update(updateData);
      
      // Retornar desde cache actualizado
      return get(col, id);
      
    } catch (error) {
      console.error(`Error actualizando ${col}/${id}:`, error);
      throw error;
    }
  }
  
  /**
   * remove - Elimina un documento
   * IMPORTANTE: Sincroniza automáticamente con Firestore
   */
  async function remove(col, id) {
    // MODO DEMO: Usar localStorage
    if (window.isDemoMode) {
      return removeDemo(col, id);
    }
    
    // MODO PRODUCCIÓN: Usar Firestore
    try {
      const collectionRef = _getCollection(col);
      await collectionRef.doc(id).delete();
    } catch (error) {
      console.error(`Error eliminando ${col}/${id}:`, error);
      throw error;
    }
  }
  
  // ========================================
  // CONFIGURACIÓN
  // ========================================
  
  /**
   * getConfig - Obtiene la configuración de la empresa
   */
  function getConfig() {
    // MODO DEMO: Leer desde localStorage
    if (window.isDemoMode) {
      return getConfigDemo();
    }
    
    // MODO PRODUCCIÓN: Leer desde cache
    return cache.config;
  }
  
  /**
   * setConfig - Guarda la configuración de la empresa
   */
  async function setConfig(data) {
    // MODO DEMO: Guardar en localStorage
    if (window.isDemoMode) {
      setConfigDemo(data);
      return;
    }
    
    // MODO PRODUCCIÓN: Guardar en Firestore
    try {
      const userId = _getUserId();
      const configRef = db.collection('users').doc(userId).collection('config').doc('company');
      await configRef.set(data, { merge: true });
    } catch (error) {
      console.error('Error guardando config:', error);
      throw error;
    }
  }
  
  // ========================================
  // CONTADORES
  // ========================================
  
  /**
   * nextNumber - Genera números incrementales (proyectos, facturas, etc.)
   * Ejemplo: DB.nextNumber('projectCounter') → 1, 2, 3, ...
   */
  async function nextNumber(key) {
    // MODO DEMO: Usar contador en localStorage
    if (window.isDemoMode) {
      return nextNumberDemo(key);
    }
    
    // MODO PRODUCCIÓN: Usar transacción en Firestore
    try {
      const userId = _getUserId();
      const counterRef = db.collection('users').doc(userId).collection('counters').doc('numbers');
      
      // Usar transacción para evitar duplicados
      const newNumber = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(counterRef);
        const currentValue = doc.exists ? (doc.data()[key] || 0) : 0;
        const nextValue = currentValue + 1;
        
        transaction.set(counterRef, { [key]: nextValue }, { merge: true });
        return nextValue;
      });
      
      return newNumber;
      
    } catch (error) {
      console.error(`Error generando ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * nextBudgetNumber - Genera números de presupuesto con formato YYMMDDXXX
   * 
   * IMPORTANTE:
   * - El contador se REINICIA cada día
   * - Primer presupuesto del día: 26080400001
   * - Segundo presupuesto del día: 26080400002
   * - Primer presupuesto del día siguiente: 26080500001
   * 
   * EJEMPLO:
   * const budgetNumber = await DB.nextBudgetNumber();
   * console.log(budgetNumber); // "26080400001"
   */
  async function nextBudgetNumber() {
    // MODO DEMO: Usar contador en localStorage
    if (window.isDemoMode) {
      return nextBudgetNumberDemo();
    }
    
    // MODO PRODUCCIÓN: Usar transacción en Firestore
    try {
      const userId = _getUserId();
      const counterRef = db.collection('users').doc(userId).collection('counters').doc('budgets');
      
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateKey = `${yy}${mm}${dd}`;
      
      const dailyCounter = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(counterRef);
        const data = doc.exists ? doc.data() : {};
        const currentCounter = data[dateKey] || 0;
        const nextCounter = currentCounter + 1;
        
        transaction.set(counterRef, { [dateKey]: nextCounter }, { merge: true });
        return nextCounter;
      });
      
      return `${yy}${mm}${dd}${String(dailyCounter).padStart(3, '0')}`;
      
    } catch (error) {
      console.error('Error generando número de presupuesto:', error);
      throw error;
    }
  }
  
  // ========================================
  // QUERIES HELPERS
  // ========================================
  
  /** Obtiene todos los presupuestos de un proyecto */
  function getBudgetsByProject(projectId) {
    return getAll('budgets').filter(b => b.projectId === projectId);
  }
  
  /** Obtiene todas las operaciones de un proyecto */
  function getOperationsByProject(projectId) {
    return getAll('operations').filter(o => o.projectId === projectId);
  }
  
  /** Obtiene todas las facturas de un proyecto */
  function getInvoicesByProject(projectId) {
    return getAll('invoices').filter(i => i.projectId === projectId);
  }
  
  /**
   * getIncomesByProject - Obtiene todos los INGRESOS de un proyecto
   * IMPORTANTE: Los ingresos son pagos del cliente (positivos)
   */
  function getIncomesByProject(projectId) {
    return getAll('incomes').filter(i => i.projectId === projectId);
  }
  
  /**
   * getExpensesByProject - Obtiene todos los GASTOS de un proyecto
   * IMPORTANTE: Los gastos son costos del proyecto (negativos)
   */
  function getExpensesByProject(projectId) {
    return getAll('expenses').filter(e => e.projectId === projectId);
  }
  
  /** Obtiene los templates (solo ARG) */
  function getTemplates() {
    return getAll('budgets').filter(b => b.isTemplate && b.administration === 'ARG');
  }
  
  /**
   * getActiveBudget - Obtiene el presupuesto aprobado de un proyecto
   * Un proyecto solo puede tener 1 presupuesto aprobado (total o parcial)
   */
  function getActiveBudget(projectId) {
    const budgets = getBudgetsByProject(projectId);
    return budgets.find(b => 
      b.status === 'aprobado-total' || b.status === 'aprobado-parcial'
    ) || null;
  }
  
  /**
   * getApprovedBudgetTotal - Calcula el monto aprobado de un presupuesto
   * 
   * IMPORTANTE:
   * - Aprobación TOTAL: Devuelve budget.total
   * - Aprobación PARCIAL: Suma solo los items con aprobado=true
   */
  function getApprovedBudgetTotal(budget) {
    if (!budget) return 0;
    if (budget.status === 'aprobado-total') {
      return budget.total || 0;
    }
    if (budget.status === 'aprobado-parcial') {
      return (budget.items || [])
        .filter(item => item.aprobado === true)
        .reduce((sum, item) => sum + (Number(item.precio) || 0), 0);
    }
    return 0;
  }
  
  /**
   * getProjectFinancials - Calcula métricas financieras de un proyecto
   * 
   * RETORNA:
   * - budgetTotal: Monto aprobado del presupuesto
   * - totalIncome: Total de ingresos del proyecto
   * - totalExpense: Total de gastos del proyecto
   * - profit: Ganancia (ingresos - gastos)
   * - totalSpent: Total de gastos del proyecto (alias de totalExpense)
   * - remaining: Lo que queda (budgetTotal - totalSpent)
   * - percentUsed: Porcentaje usado
   */
  function getProjectFinancials(projectId) {
    const budget = getActiveBudget(projectId);
    const budgetTotal = getApprovedBudgetTotal(budget);
    
    const incomes = getIncomesByProject(projectId);
    const totalIncome = incomes.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
    
    const expenses = getExpensesByProject(projectId);
    const totalExpense = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalSpent = totalExpense; // Alias para compatibilidad
    
    const profit = totalIncome - totalExpense;
    const remaining = budgetTotal - totalSpent;
    const percentUsed = budgetTotal > 0 ? (totalSpent / budgetTotal) * 100 : 0;
    
    return {
      budgetTotal,
      totalIncome,
      totalExpense,
      totalSpent,
      profit,
      remaining,
      percentUsed: Math.round(percentUsed)
    };
  }
  
  /**
   * getDashboardStats - Calcula métricas para el dashboard principal
   * 
   * IMPORTANTE: Estas son las 4 KPIs que se muestran en el dashboard:
   * 1. activeProjects - Proyectos con estado 'activo'
   * 2. pendingBudgets - Presupuestos 'borrador' + 'enviado'
   * 3. cancelledBudgets - Presupuestos 'rechazado'
   * 4. totalEarnings - Suma de ganancias de las 3 administraciones
   * 
   * RETORNA:
   * - activeProjects: Cantidad de proyectos activos
   * - pendingBudgets: Cantidad de presupuestos pendientes
   * - cancelledBudgets: Cantidad de presupuestos cancelados
   * - earningsARG: Ganancias en pesos argentinos
   * - earningsPERU: Ganancias en soles peruanos
   * - earningsUSA: Ganancias en dólares estadounidenses
   * - totalEarnings: Suma total de todas las ganancias
   */
  function getDashboardStats() {
    const projects = getAll('projects');
    const budgets = getAll('budgets');
    const operations = getAll('operations');
    
    // Proyectos activos — aceptar variantes de estado ('activo' o 'aprobado')
    const activeProjects = projects.filter(p => ['activo','aprobado'].includes(p.status)).length;
    
    // Presupuestos pendientes (borrador + enviado)
    const pendingBudgets = budgets.filter(b => ['borrador','enviado'].includes(b.status)).length;
    
    // Presupuestos cancelados
    const cancelledBudgets = budgets.filter(b => b.status === 'rechazado').length;
    
    // Ganancias totales por administración
    const earningsARG = operations
      .filter(o => o.tipo === 'ingreso' && o.administration === 'ARG')
      .reduce((s, r) => s + (Number(r.monto) || 0), 0);
    
    const earningsPERU = operations
      .filter(o => o.tipo === 'ingreso' && o.administration === 'PERU')
      .reduce((s, r) => s + (Number(r.monto) || 0), 0);
    
    const earningsUSA = operations
      .filter(o => o.tipo === 'ingreso' && o.administration === 'USA')
      .reduce((s, r) => s + (Number(r.monto) || 0), 0);
    
    const totalEarnings = earningsARG + earningsPERU + earningsUSA;
    
    // Stats adicionales para administraciones
    const totalProjects = projects.length;
    // Contabilizar proyectos completados o aprobados como finalizados
    const completedProjects = projects.filter(p => ['completado','aprobado'].includes(p.status)).length;
    
    const totalSpent = operations
      .filter(o => o.tipo === 'egreso')
      .reduce((s, r) => s + (Number(r.monto) || 0), 0);
    
    return {
      activeProjects,
      pendingBudgets,
      cancelledBudgets,
      earningsARG,
      earningsPERU,
      earningsUSA,
      totalEarnings,
      totalProjects,
      completedProjects,
      totalSpent
    };
  }
  
  /**
   * getMonthlyData - Genera datos de ingresos mensuales para el gráfico
   * Retorna los últimos 12 meses con ingresos por administración
   */
  function getMonthlyData() {
    const operations = getAll('operations');
    const now = new Date();
    
    const monthlyData = [];
    
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('es-ES', { month: 'short', year: 'numeric' });
      
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      
      const earningsARG = operations
        .filter(o => o.tipo === 'ingreso' && o.administration === 'ARG' && o.date?.startsWith(monthKey))
        .reduce((s, r) => s + (Number(r.monto) || 0), 0);
      
      const earningsPERU = operations
        .filter(o => o.tipo === 'ingreso' && o.administration === 'PERU' && o.date?.startsWith(monthKey))
        .reduce((s, r) => s + (Number(r.monto) || 0), 0);
      
      const earningsUSA = operations
        .filter(o => o.tipo === 'ingreso' && o.administration === 'USA' && o.date?.startsWith(monthKey))
        .reduce((s, r) => s + (Number(r.monto) || 0), 0);
      
      monthlyData.push({
        label,
        earningsARG,
        earningsPERU,
        earningsUSA
      });
    }
    
    return monthlyData;
  }
  
  // ========================================
  // INICIALIZACIÓN
  // ========================================
  
  /**
   * init - Inicializa listeners de Firestore
   * IMPORTANTE: Debe llamarse después del login
   */
  async function init() {
    // MODO DEMO: No hay listeners, todo funciona con localStorage
    if (window.isDemoMode) {
      console.log('✅ DB inicializado en MODO DEMO (localStorage)');
      return;
    }
    
    // MODO PRODUCCIÓN: Iniciar listeners de Firestore
    try {
      if (!Auth.isAuthenticated()) {
        console.warn('⚠️ Usuario no autenticado, no se pueden inicializar listeners');
        return;
      }
      
      // Iniciar listeners para todas las colecciones
      _startListener('budgets');
      _startListener('projects');
      _startListener('incomes');
      _startListener('expenses');
      _startListener('operations');
      _startListener('invoices');
      _startConfigListener();
      
      console.log('✅ DB inicializado con listeners en tiempo real');
      
    } catch (error) {
      console.error('❌ Error inicializando DB:', error);
    }
  }
  
  /**
   * destroy - Detiene todos los listeners
   * IMPORTANTE: Llamar al cerrar sesión
   */
  function destroy() {
    Object.values(listeners).forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    });
    
    // Limpiar cache
    cache.budgets = [];
    cache.projects = [];
    cache.incomes = [];
    cache.expenses = [];
    cache.operations = [];
    cache.invoices = [];
    cache.config = null;
    
    console.log('✅ DB listeners detenidos');
  }
  
  // ========================================
  // EXPORTAR API
  // ========================================
  
  return {
    // CRUD
    getAll,
    get,
    add,
    update,
    remove,
    
    // Configuración
    getConfig,
    setConfig,
    
    // Contadores
    nextNumber,
    nextBudgetNumber,
    
    // Queries
    getBudgetsByProject,
    getOperationsByProject,
    getInvoicesByProject,
    getIncomesByProject,
    getExpensesByProject,
    getTemplates,
    getActiveBudget,
    getApprovedBudgetTotal,
    getProjectFinancials,
    getDashboardStats,
    getMonthlyData,
    
    // Lifecycle
    init,
    destroy
  };
})();
