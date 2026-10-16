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
  
  function invoiceNumberDate(date) {
    const now = date === undefined ? new Date() : new Date(`${date}T12:00:00`);
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(now.getTime()) ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` !== date)) {
      throw new Error('Seleccioná una fecha de factura válida.');
    }
    return now;
  }

  function lastUsedInvoiceNumber(records, dateKey) {
    return records.reduce((max, record) => {
      const number = String(record.number ?? record.invoiceNumber ?? record.budgetNumber ?? '').replace('-', '');
      return number.startsWith(dateKey) && /^\d{9,}$/.test(number) ? Math.max(max, Number(number.slice(6))) : max;
    }, 0);
  }

  function nextBudgetNumberDemo(date) {
    const counters = localStorage.getItem('aurea2_budget_counters');
    const data = counters ? JSON.parse(counters) : {};
    
    const now = invoiceNumberDate(date);
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateKey = `${yy}${mm}${dd}`;
    
    const records = date === undefined ? [] : [...getAllDemo('budgets'), ...getAllDemo('invoices').flatMap(inv => [inv, ...(inv.history || [])])];
    const current = Math.max(data[dateKey] || 0, lastUsedInvoiceNumber(records, dateKey));
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
    clients: [],
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
   * sanitizeForFirestore - Remove undefined values from objects/arrays recursively
   * Firestore does not accept `undefined` as a field value; convert/remove them.
   */
  function sanitizeForFirestore(value) {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (Array.isArray(value)) {
      return value.map(v => sanitizeForFirestore(v));
    }
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => {
        // Do not send internal sample marker to Firestore
        if (k === '__sample') return;
        const v = value[k];
        const s = sanitizeForFirestore(v);
        if (s !== undefined) out[k] = s;
      });
      return out;
    }
    return value;
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

  async function _hydrateCollection(col) {
    try {
      const snapshot = await _getCollection(col).get();
      const data = [];
      snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
      cache[col] = data;
      return data;
    } catch (error) {
      console.error(`Error cargando ${col} desde Firestore:`, error);
      cache[col] = [];
      return [];
    }
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
      // Remove undefined values which Firestore rejects
      const safeDocData = sanitizeForFirestore(docData);
      
      // Si no tiene ID, usar ID generado por Firestore
      if (data.id) {
        await collectionRef.doc(data.id).set(safeDocData);
        return { id: data.id, ...safeDocData };
      } else {
        const docRef = await collectionRef.add(safeDocData);
        return { id: docRef.id, ...safeDocData };
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
      // Remove undefined values from update payload
      const safeUpdate = sanitizeForFirestore(updateData);
      await collectionRef.doc(id).update(safeUpdate);
      
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
    try {
      const collectionRef = _getCollection(col);
      await collectionRef.doc(id).delete();
    } catch (error) {
      console.error(`Error eliminando ${col}/${id}:`, error);
      throw error;
    }
  }

  async function saveProjectInvoice(projectId, invoiceId, data, expectedVersion) {
    if (window.isDemoMode) {
      const project = getDemo('projects', projectId);
      if (!project || project.administration !== 'USA') throw new Error('Proyecto USA no encontrado.');
      const invoices = getAllDemo('invoices').filter(inv => inv.projectId === projectId);
      const current = invoiceId ? invoices.find(inv => inv.id === invoiceId) : null;
      if (invoiceId && (!current || (current.version || 1) !== expectedVersion)) {
        throw new Error('La factura cambió o fue eliminada. Volvé a abrirla antes de guardar.');
      }
      if (!invoiceId && data.budgetId) {
        const existing = invoices.find(inv => inv.budgetId === data.budgetId);
        if (existing) return existing;
      }
      const invoice = data ? { ...current, ...data, projectId, id: invoiceId || _id() } : null;
      const totals = Object.fromEntries(invoices.map(inv => [inv.id, inv.total ?? (inv.items || []).reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.unitPrice || 0), 0)]));
      const previousInvoices = getAllDemo('invoices');
      const previousProjects = getAllDemo('projects');
      try {
        if (invoice) {
          if (invoiceId) updateDemo('invoices', invoiceId, invoice);
          else {
            _setLocalStorage('invoices', [...previousInvoices, invoice]);
          }
          totals[invoice.id] = invoice.total;
        } else {
          removeDemo('invoices', invoiceId);
          delete totals[invoiceId];
        }
        updateDemo('projects', projectId, { invoiceTotals: totals, budgetAmount: Number(Object.values(totals).reduce((sum, total) => sum + total, 0).toFixed(2)) });
        return invoice;
      } catch (error) {
        _setLocalStorage('invoices', previousInvoices);
        _setLocalStorage('projects', previousProjects);
        throw error;
      }
    }

    try {
      const invoicesRef = _getCollection('invoices');
      const invoiceRef = invoiceId ? invoicesRef.doc(invoiceId) : invoicesRef.doc();
      const projectRef = _getCollection('projects').doc(projectId);
      // Seed legacy projects; subsequent transactions use the persisted map.
      const existingInvoices = await invoicesRef.where('projectId', '==', projectId).get();
      const initialTotals = {};
      const initialBudgetIds = {};
      existingInvoices.forEach(doc => {
        const inv = doc.data();
        initialTotals[doc.id] = inv.total ?? (inv.items || []).reduce((sum, it) => sum + Number(it.qty || 0) * Number(it.unitPrice || 0), 0);
        if (inv.budgetId) initialBudgetIds[inv.budgetId] = doc.id;
      });
      return await db.runTransaction(async transaction => {
        const projectDoc = await transaction.get(projectRef);
        const invoiceDoc = invoiceId ? await transaction.get(invoiceRef) : null;
        const project = projectDoc.exists ? projectDoc.data() : null;
        if (!project || project.administration !== 'USA') throw new Error('Proyecto USA no encontrado.');
        const current = invoiceDoc?.exists ? invoiceDoc.data() : null;
        if (invoiceId && (!current || current.projectId !== projectId || (current.version || 1) !== expectedVersion)) {
          throw new Error('La factura cambió o fue eliminada. Volvé a abrirla antes de guardar.');
        }
        const budgetIds = { ...(project.budgetInvoiceIds || initialBudgetIds) };
        if (!invoiceId && data.budgetId && budgetIds[data.budgetId]) {
          const existing = await transaction.get(invoicesRef.doc(budgetIds[data.budgetId]));
          if (existing.exists) return { ...existing.data(), id: existing.id };
        }
        const totals = { ...(project.invoiceTotals || initialTotals) };
        const invoice = data ? { ...data, projectId, id: invoiceRef.id } : null;
        if (invoice) {
          totals[invoiceRef.id] = invoice.total;
          if (invoice.budgetId) budgetIds[invoice.budgetId] = invoiceRef.id;
          const payload = sanitizeForFirestore(invoice);
          payload.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
          transaction.set(invoiceRef, payload, { merge: true });
        } else {
          delete totals[invoiceId];
          if (current.budgetId) delete budgetIds[current.budgetId];
          transaction.delete(invoiceRef);
        }
        transaction.update(projectRef, {
          invoiceTotals: totals,
          budgetInvoiceIds: budgetIds,
          budgetAmount: Number(Object.values(totals).reduce((sum, total) => sum + total, 0).toFixed(2)),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        return invoice;
      });
    } catch (error) {
      console.error('Error guardando factura y monto del proyecto:', error);
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
      const safe = sanitizeForFirestore(data);
      await configRef.set(safe, { merge: true });
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
   * Fecha opcional YYYY-MM-DD: reserva el correlativo de ese dia.
   */
  async function nextBudgetNumber(date) {
    // MODO DEMO: Usar contador en localStorage
    if (window.isDemoMode) {
      return nextBudgetNumberDemo(date);
    }
    
    // MODO PRODUCCIÓN: Usar transacción en Firestore
    try {
      const userId = _getUserId();
      const counterRef = db.collection('users').doc(userId).collection('counters').doc('budgets');
      
      const now = invoiceNumberDate(date);
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const dateKey = `${yy}${mm}${dd}`;
      const records = [];
      if (date !== undefined) {
        const [budgets, invoices] = await Promise.all([_getCollection('budgets').get(), _getCollection('invoices').get()]);
        budgets.forEach(doc => records.push(doc.data()));
        invoices.forEach(doc => {
          const invoice = doc.data();
          records.push(invoice, ...(invoice.history || []));
        });
      }
      const lastUsed = lastUsedInvoiceNumber(records, dateKey);
      
      const dailyCounter = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(counterRef);
        const data = doc.exists ? doc.data() : {};
        const currentCounter = Math.max(data[dateKey] || 0, lastUsed);
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
   * - Aprobación TOTAL: Devuelve budget.total (ya incluye IVA/IGV si corresponde, se calculó al guardar)
   * - Aprobación PARCIAL: Suma solo los items con aprobado=true y les aplica el mismo
   *   IVA/IGV que al resto del presupuesto (Perú: siempre 18%; Argentina: 21% solo si
   *   budget.iva === 'con'; resto de administraciones: sin impuesto).
   *
   * FIX: antes esta función sumaba item.precio, un campo que no existe en los ítems del
   * presupuesto (los ítems usan qty/unitPrice) y tampoco aplicaba IVA/IGV — por lo que
   * una aprobación PARCIAL siempre daba $0 y, de no ser así, hubiera quedado sin impuesto.
   */
  function getApprovedBudgetTotal(budget) {
    if (!budget) return 0;
    if (budget.status === 'aprobado-total') {
      return budget.total || 0;
    }
    if (budget.status === 'aprobado-parcial') {
      const adm = String(budget.administration || '').toUpperCase();
      const ivaMode = adm === 'PERU' ? 'con' : ((adm === 'ARG' && budget.iva === 'con') ? 'con' : 'sin');
      const taxRate = (adm === 'ARG' && ivaMode === 'con') ? 0.21 : ((adm === 'PERU' && ivaMode === 'con') ? 0.18 : 0);
      const subtotal = (budget.items || [])
        .filter(item => item.aprobado === true)
        .reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)), 0);
      return Number((subtotal * (1 + taxRate)).toFixed(2));
    }
    return 0;
  }
  
  /**
   * _effectiveExchangeRate - Resuelve qué tipo de cambio (moneda local por 1 USD) usar
   * para normalizar un proyecto a dólares.
   *
   * Orden de prioridad:
   * 1. project.exchangeRateToUSD (única fuente editable desde la app — se carga en la
   *    pantalla del Proyecto, abajo de todo).
   * 2. exchangeRateToUSD del presupuesto activo/aprobado — SOLO como respaldo, por
   *    compatibilidad con presupuestos viejos que todavía tengan un valor guardado de
   *    antes de que el campo se sacara del formulario de Presupuestos. Ya no se puede
   *    cargar/editar desde ahí.
   * 3. USA → 1 (ya está en USD)
   * 4. Sin dato → 0 (no se puede normalizar; se excluye de los totales en USD)
   *
   * IMPORTANTE: esta información es de uso interno (gráficos de Inicio y Administraciones).
   * Nunca debe usarse para armar el PDF del presupuesto ni de la factura.
   */
  function _effectiveExchangeRate(project, budget) {
    const adm = String((project && project.administration) || '').toUpperCase();
    let rate = Number(project && project.exchangeRateToUSD);
    if (!isFinite(rate) || rate <= 0) {
      rate = Number(budget && budget.exchangeRateToUSD);
    }
    if (!isFinite(rate) || rate <= 0) {
      rate = (adm === 'USA') ? 1 : 0;
    }
    return rate;
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
    const project = get('projects', projectId) || {};
    // budgetTotal ("Presupuesto Aprobado"): se lee del PROYECTO (project.budgetAmount),
    // que queda congelado con el monto correcto (misma fórmula, mismo IVA/IGV) apenas se
    // aprueba un presupuesto — ver saveBudgetForm/approveBudget/createInvoiceFromBudget en
    // app.js. Antes esto se recalculaba ACÁ leyendo los items del presupuesto de nuevo
    // (getApprovedBudgetTotal), lo que generaba números distintos entre Proyectos,
    // Administración/Inicio y la pestaña Finanzas ("está tomando el IVA como parte del
    // total" que reportó el cliente). Si el proyecto todavía no tiene ese campo guardado
    // (proyectos viejos, o sin presupuesto vinculado), usamos el cálculo anterior como
    // respaldo.
    const budgetTotal = (project.budgetAmount !== undefined && project.budgetAmount !== null)
      ? (Number(project.budgetAmount) || 0)
      : getApprovedBudgetTotal(budget);

    const incomes = getIncomesByProject(projectId);
    const totalIncomeGross = incomes.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

    // FIX: antes se le quitaba el IVA/IGV a TODOS los ingresos del proyecto usando una única
    // tasa fija según la administración del proyecto (ARG 21% / PERU 18%), sin importar si ESE
    // ingreso en particular realmente tenía impuesto incluido. Esto restaba IVA/IGV de ingresos
    // que nunca lo tuvieron: un ingreso manual (cargado a mano, sin presupuesto asociado) o un
    // ingreso de un presupuesto de Argentina cargado "Sin IVA" — el resultado se veía como un
    // IVA "duplicado" (se descontaba un impuesto que jamás se había cobrado).
    //
    // Ahora se calcula ingreso por ingreso:
    // - Ingreso automático (vinculado a un presupuesto vía budgetId): se usa el impuesto real de
    //   ESE presupuesto (Perú siempre IGV 18%; Argentina 21% solo si tenía "+IVA" tildado).
    // - Ingreso manual (sin presupuesto asociado): se toma el monto tal cual, sin restarle ningún
    //   impuesto, porque no hay forma de saber si ya lo incluye.
    const totalIncome = incomes.reduce((sum, i) => {
      const amount = Number(i.amount) || 0;
      let rate = 0;
      if (i.budgetId) {
        const linkedBudget = get('budgets', i.budgetId);
        if (linkedBudget) {
          const badm = String(linkedBudget.administration || '').toUpperCase();
          const bIvaMode = badm === 'PERU' ? 'con' : ((badm === 'ARG' && linkedBudget.iva === 'con') ? 'con' : 'sin');
          rate = (badm === 'ARG' && bIvaMode === 'con') ? 0.21 : ((badm === 'PERU' && bIvaMode === 'con') ? 0.18 : 0);
        }
      }
      return sum + (rate > 0 ? (amount / (1 + rate)) : amount);
    }, 0);

    const expenses = getExpensesByProject(projectId);
    const totalExpense = expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const totalSpent = totalExpense; // Alias para compatibilidad

    // La ganancia es el número que se muestra y suma en Proyectos, Inicio y
    // Administraciones. Se redondea una sola vez para que los totales coincidan con las filas.
    const profit = Math.round((project.administration === 'USA' && project.invoiceTotals ? budgetTotal : totalIncome) - totalExpense);
    // Redondeamos "remaining" a un número entero de moneda local ACÁ, en el único lugar
    // donde se calcula. Así, la lista de Proyectos (que muestra cada fin.remaining por
    // fila) y Administraciones/Inicio (que SUMAN fin.remaining de todos los proyectos y
    // después redondean el total) parten siempre del mismo número entero, y la suma de
    // las filas coincide exacto con el total mostrado arriba. Sin este redondeo acá, el
    // presupuesto podía traer decimales (por el cálculo de IVA/IGV) y aparecía una
    // diferencia de $1 entre la lista y el total (suma de redondeados ≠ redondeo de la suma).
    const remaining = Math.round(budgetTotal - totalSpent);
    const percentUsed = budgetTotal > 0 ? (totalSpent / budgetTotal) * 100 : 0;

    // Conversión a USD (moneda local por 1 USD). USA = 1 por defecto.
    const rate = _effectiveExchangeRate(project, budget);
    const profitUSD = rate > 0 ? (profit / rate) : 0;
    const budgetTotalUSD = rate > 0 ? (budgetTotal / rate) : 0;
    // remainingUSD: el "saldo" del proyecto (Presupuesto aprobado − Gastos) convertido a
    // dólares. Es lo que se usa para los gráficos (Inicio y Administraciones) — ver
    // getDashboardStats más abajo — porque representa un proyecto ya confirmado (con
    // presupuesto aprobado), a diferencia de profit/profitUSD que depende de los Ingresos
    // cargados a mano y puede no reflejar todavía el total presupuestado.
    const remainingUSD = rate > 0 ? (remaining / rate) : 0;

    return {
      budgetTotal,
      totalIncome, // net (sin impuesto)
      totalIncomeGross,
      totalExpense,
      totalSpent,
      profit,
      remaining,
      percentUsed: Math.round(percentUsed),
      exchangeRateToUSD: rate,
      profitUSD,
      budgetTotalUSD,
      remainingUSD
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
  function _recordYear(record) {
    const raw = record && (record.date || record.createdAt || record.created || record.created_at || record.startDate || record.start_date);
    if (!raw) return 0;
    if (typeof raw === 'object' && typeof raw.toDate === 'function') return raw.toDate().getFullYear();
    if (typeof raw === 'object' && typeof raw.seconds === 'number') return new Date(raw.seconds * 1000).getFullYear();
    if (typeof raw === 'string') {
      const isoYear = raw.match(/^(\d{4})-/);
      if (isoYear) return Number(isoYear[1]);
      const localYear = raw.match(/^\d{1,2}\/\d{1,2}\/(\d{4})$/);
      if (localYear) return Number(localYear[1]);
    }
    const date = new Date(raw);
    return isNaN(date.getTime()) ? 0 : date.getFullYear();
  }

  function getDashboardStats(year = new Date().getFullYear()) {
    const selectedYear = Number(year) || new Date().getFullYear();
    const projects = getAll('projects').filter(project => _recordYear(project) === selectedYear);
    const budgets = getAll('budgets').filter(budget => _recordYear(budget) === selectedYear);

    // Proyectos activos — aceptar variantes de estado ('activo' o 'aprobado')
    const activeProjects = projects.filter(p => ['activo','aprobado'].includes(p.status)).length;

    // Presupuestos pendientes (borrador + enviado)
    const pendingBudgets = budgets.filter(b => ['borrador','enviado'].includes(b.status)).length;

    // Presupuestos cancelados
    const cancelledBudgets = budgets.filter(b => b.status === 'rechazado').length;

    // Ganancias por administración = suma de la ganancia neta de cada proyecto
    // (Ingresos sin IVA/IGV - Gastos). Los valores negativos se restan del total.
    const earnings = { ARG: 0, PERU: 0, USA: 0 };
    // Equivalente en USD por administración, usando el tipo de cambio cargado en cada
    // proyecto (campo exchangeRateToUSD del proyecto — ver _effectiveExchangeRate).
    // Esto es lo que permite comparar ARG/PERU/USA en los gráficos aunque manejen montos muy distintos.
    const earningsUSDByAdmin = { ARG: 0, PERU: 0, USA: 0 };
    let earningsUSD = 0;
    projects.forEach(p => {
      try {
        const fin = getProjectFinancials(p.id);
        const adm = String(p.administration || '').toUpperCase();
        const projectProfit = Number(fin.profit || 0) || 0;
        const projectProfitUSD = Number(fin.profitUSD || 0) || 0;
        if (adm === 'ARG') { earnings.ARG += projectProfit; earningsUSDByAdmin.ARG += projectProfitUSD; }
        else if (adm === 'PERU') { earnings.PERU += projectProfit; earningsUSDByAdmin.PERU += projectProfitUSD; }
        else if (adm === 'USA') { earnings.USA += projectProfit; earningsUSDByAdmin.USA += projectProfitUSD; }
        earningsUSD += projectProfitUSD;
      } catch (e) { /* ignore */ }
    });

    const earningsARG = earnings.ARG;
    const earningsPERU = earnings.PERU;
    const earningsUSA = earnings.USA;
    // totalEarnings queda como consolidado en USD (única moneda válida para sumar entre países)
    const totalEarnings = earningsUSD;

    const totalProjects = projects.length;
    const completedProjects = projects.filter(p => ['completado','aprobado'].includes(p.status)).length;

    const totalSpent = getAll('operations')
      .filter(o => o.tipo === 'egreso')
      .reduce((s, r) => s + (Number(r.monto) || 0), 0);

    return {
      activeProjects,
      pendingBudgets,
      cancelledBudgets,
      earningsARG,
      earningsPERU,
      earningsUSA,
      earningsARG_USD: earningsUSDByAdmin.ARG,
      earningsPERU_USD: earningsUSDByAdmin.PERU,
      earningsUSA_USD: earningsUSDByAdmin.USA,
      earningsUSD,
      totalEarnings,
      totalProjects,
      completedProjects,
      totalSpent
    };
  }
  
  /**
  * getMonthlyData - Genera datos de ganancias mensuales para el gráfico de Inicio.
  * Cada proyecto aporta su ganancia neta (Ingresos sin IVA/IGV - Gastos), normalizada
  * a USD con el tipo de cambio cargado en ese proyecto.
   *
   * IMPORTANTE: un proyecto sin tipo de cambio cargado (ARG/PERU) no puede normalizarse
   * y queda afuera de este cálculo hasta que se le cargue el valor del dólar.
   */
  function getMonthlyData(year = new Date().getFullYear()) {
    const selectedYear = Number(year) || new Date().getFullYear();
    const monthlyData = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
      const d = new Date(selectedYear, monthIndex, 1);
      monthlyData.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('es-ES', { month: 'short' }),
        earningsARG: 0,
        earningsPERU: 0,
        earningsUSA: 0
      });
    }

    const projects = getAll('projects').filter(project => _recordYear(project) === selectedYear);
    projects.forEach(project => {
      const rawDate = project.date || project.createdAt || project.created;
      const date = rawDate && typeof rawDate.toDate === 'function' ? rawDate.toDate() : rawDate;
      const key = date instanceof Date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : String(date || '').slice(0, 7);
      const month = monthlyData.find(m => m.key === key);
      if (!month) return;
      const usd = Number(getProjectFinancials(project.id).profitUSD || 0) || 0;
      const adm = String(project.administration || '').toUpperCase();
      if (adm === 'ARG') month.earningsARG += usd;
      else if (adm === 'PERU') month.earningsPERU += usd;
      else if (adm === 'USA') month.earningsUSA += usd;
    });

    return monthlyData.map(m => ({
      label: m.label,
      earningsARG: Math.round(m.earningsARG),
      earningsPERU: Math.round(m.earningsPERU),
      earningsUSA: Math.round(m.earningsUSA)
    }));
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
        await new Promise((resolve) => {
          const unsubscribe = Auth.onAuthStateChanged((user) => {
            if (user) {
              unsubscribe();
              resolve();
            }
          });
          setTimeout(() => {
            unsubscribe();
            resolve();
          }, 1500);
        });
      }

      if (!Auth.isAuthenticated()) {
        console.warn('⚠️ Usuario no autenticado, no se pueden inicializar listeners');
        return;
      }

      const collections = ['budgets', 'projects', 'clients', 'incomes', 'expenses', 'operations', 'invoices'];
      for (const col of collections) {
        await _hydrateCollection(col);
      }
      await _hydrateCollection('config');

      // Iniciar listeners para todas las colecciones
      _startListener('budgets');
      _startListener('projects');
      _startListener('clients');
      _startListener('incomes');
      _startListener('expenses');
      _startListener('operations');
      _startListener('invoices');
      _startConfigListener();
      
      console.log('✅ DB inicializado con caché y listeners en tiempo real');
      
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
    cache.clients = [];
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
    saveProjectInvoice,
    
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