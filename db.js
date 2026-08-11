/**
 * Aurea DB — Capa de datos local (localStorage)
 * CRUD genérico + helpers para consultas comunes
 * 
 * GUÍA RÁPIDA:
 * - Todo se guarda en localStorage del navegador (sin backend)
 * - Cada "colección" es un array de objetos (budgets, projects, incomes, etc.)
 * - Prefix 'aurea2_' para evitar conflictos con otras apps
 * 
 * COLECCIONES:
 * - budgets: Presupuestos
 * - projects: Proyectos
 * - operations: Operaciones generales
 * - invoices: Facturas
 * - incomes: Ingresos de proyectos
 * - expenses: Gastos de proyectos
 * - config: Configuración de la empresa
 * 
 * USO:
 * DB.getAll('budgets')           // Obtener todos los presupuestos
 * DB.get('budgets', id)          // Obtener presupuesto por ID
 * DB.add('budgets', {...})       // Crear presupuesto nuevo
 * DB.update('budgets', id, {...}) // Actualizar presupuesto
 * DB.remove('budgets', id)       // Eliminar presupuesto
 */
const DB = (() => {
  'use strict';
  const P = 'aurea2_'; // Prefix para localStorage

  // ── Helpers internos (no se exponen) ──────────────────────────────────────
  function _load(col) {
    try { return JSON.parse(localStorage.getItem(P + col) || '[]'); }
    catch { return []; }
  }
  function _save(col, data) {
    localStorage.setItem(P + col, JSON.stringify(data));
  }
  function _id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── CRUD genérico ─────────────────────────────────────────────────────────
  function getAll(col) { return _load(col); }

  function get(col, id) {
    return _load(col).find(r => r.id === id) || null;
  }

  function add(col, data) {
    const rows = _load(col);
    const row = { ...data, id: data.id || _id(), createdAt: data.createdAt || new Date().toISOString() };
    rows.push(row);
    _save(col, rows);
    return row;
  }

  function update(col, id, data) {
    const rows = _load(col);
    const i = rows.findIndex(r => r.id === id);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...data, updatedAt: new Date().toISOString() };
    _save(col, rows);
    return rows[i];
  }

  function remove(col, id) {
    _save(col, _load(col).filter(r => r.id !== id));
  }

  // ── Configuración (objeto único) ──────────────────────────────────────────
  function getConfig() {
    try { return JSON.parse(localStorage.getItem(P + 'config') || 'null'); }
    catch { return null; }
  }
  function setConfig(data) {
    localStorage.setItem(P + 'config', JSON.stringify(data));
  }

  // ── Contadores auto-incremento ────────────────────────────────────────────
  
  /**
   * nextNumber - Genera números incrementales (proyectos, facturas, etc.)
   * Ejemplo: DB.nextNumber('projectCounter') → 1, 2, 3, ...
   */
  function nextNumber(key) {
    const cfg = getConfig() || {};
    const n = (cfg[key] || 0) + 1;
    setConfig({ ...cfg, [key]: n });
    return n;
  }

  /**
  * nextBudgetNumber - Genera números de presupuesto con formato yymmddNNN
  *
  * IMPORTANTE:
  * - El contador se REINICIA cada día
  * - Primer presupuesto del día: 260803001
  * - Segundo presupuesto del día: 260803002
  * - Primer presupuesto del día siguiente: 260804001
  *
  * Ejemplo: nextBudgetNumber() → "260803001"
   */
  function nextBudgetNumber() {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateKey = `${yy}${mm}${dd}`;
    
    const cfg = getConfig() || {};
    const budgetCounters = cfg.budgetCounters || {};
    const dailyCounter = (budgetCounters[dateKey] || 0) + 1;
    
    budgetCounters[dateKey] = dailyCounter;
    setConfig({ ...cfg, budgetCounters });
    
    return `${yy}${mm}${dd}${String(dailyCounter).padStart(3, '0')}`;
  }

  // ── Queries helpers (filtros por proyecto) ───────────────────────────
  
  /**
   * getBudgetsByProject - Obtiene todos los presupuestos de un proyecto
   * Ejemplo: DB.getBudgetsByProject('project123') → Array de presupuestos
   */
  function getBudgetsByProject(projectId) {
    return _load('budgets').filter(b => b.projectId === projectId);
  }
  
  /**
   * getOperationsByProject - Obtiene todas las operaciones de un proyecto
   */
  function getOperationsByProject(projectId) {
    return _load('operations').filter(e => e.projectId === projectId);
  }
  
  /**
   * getInvoicesByProject - Obtiene todas las facturas de un proyecto
   */
  function getInvoicesByProject(projectId) {
    return _load('invoices').filter(i => i.projectId === projectId);
  }
  
  /**
   * getIncomesByProject - Obtiene todos los INGRESOS de un proyecto
   * IMPORTANTE: Aquí se registran los pagos del cliente
   */
  function getIncomesByProject(projectId) {
    return _load('incomes').filter(i => i.projectId === projectId);
  }
  
  /**
   * getExpensesByProject - Obtiene todos los GASTOS de un proyecto
   * IMPORTANTE: Aquí se registran los costos del proyecto
   */
  function getExpensesByProject(projectId) {
    return _load('expenses').filter(e => e.projectId === projectId);
  }
  
  function getTemplates() {
    return _load('templates');
  }
  
  /**
   * getActiveBudget - Obtiene el presupuesto aprobado de un proyecto
   * Solo busca presupuestos con estado 'aprobado-total' o 'aprobado-parcial'
   * @returns Presupuesto aprobado o null si no hay ninguno
   */
  function getActiveBudget(projectId) {
    const budgets = getBudgetsByProject(projectId);
    return budgets.find(b => 
      b.status === 'aprobado-total' || b.status === 'aprobado-parcial'
    ) || null;
  }
  
  /**
   * getApprovedBudgetTotal - Calcula el total aprobado del presupuesto
   * 
   * IMPORTANTE:
   * - Si es aprobación TOTAL → Suma todo (budget.total)
   * - Si es aprobación PARCIAL → Suma solo los items con aprobado=true
   * 
   * @param {object} budget - Presupuesto a calcular
   * @returns {number} Total aprobado
   */
  function getApprovedBudgetTotal(budget) {
    if (!budget) return 0;
    if (budget.status === 'aprobado-parcial') {
      return budget.items
        .filter(item => item.aprobado)
        .reduce((sum, item) => {
          const amount = item.amount || (item.qty * item.rate);
          return sum + (Number(amount) || 0);
        }, 0);
    }
    return budget.total || 0;
  }

  /**
   * getProjectFinancials - Calcula totales económicos de un proyecto
   * 
   * RETORNA:
   * - budgetTotal: Monto aprobado del presupuesto
   * - totalSpent: Total gastado en operaciones
   * - remaining: Presupuesto restante (budgetTotal - totalSpent)
   * - percentUsed: Porcentaje usado del presupuesto
   */
  function getProjectFinancials(projectId) {
    // Use incomes and expenses collections to compute financials
    const incomes = _load('incomes').filter(i => i.projectId === projectId);
    const expenses = _load('expenses').filter(e => e.projectId === projectId);
    const totalIncome = incomes.reduce((s, r) => s + (Number(r.amount || r.monto || 0) || 0), 0);
    const totalExpense = expenses.reduce((s, r) => s + (Number(r.amount || r.monto || 0) || 0), 0);
    const budget = getActiveBudget(projectId);
    const budgetTotal = getApprovedBudgetTotal(budget);
    const remaining = budgetTotal - totalExpense;
    const profit = totalIncome - totalExpense;
    const percentUsed = budgetTotal > 0 ? (totalExpense / budgetTotal) * 100 : 0;
    return {
      totalIncome,
      totalExpense,
      profit,
      budgetTotal,
      totalSpent: totalExpense,
      remaining,
      percentUsed
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
    const projects = _load('projects');
    const budgets = _load('budgets');
    const incomes = _load('incomes');

    // Proyectos activos — aceptar variantes 'activo' o 'aprobado'
    const activeProjects = projects.filter(p => ['activo','aprobado'].includes(p.status)).length;

    // Presupuestos pendientes (aceptar variantes en inglés/español)
    const pendingStates = ['borrador','enviado','pending','draft'];
    const pendingBudgets = budgets.filter(b => pendingStates.includes((b.status||'').toString())).length;

    // Presupuestos cancelados (aceptar variantes)
    const cancelledStates = ['rechazado','cancelado','cancelled'];
    const cancelledBudgets = budgets.filter(b => cancelledStates.includes((b.status||'').toString())).length;

    // Ganancias totales por administración — sumar tanto 'incomes' como 'operations' tipo 'ingreso'
    const earnings = { ARG: 0, PERU: 0, USA: 0 };

    // Sumar incomes (colección explícita de ingresos)
    incomes.forEach(i => {
      const proj = _load('projects').find(p => p.id === i.projectId) || {};
      const adm = proj.administration || i.administration || i.currency || 'ARG';
      const amt = Number(i.amount || i.monto || 0) || 0;
      if (adm === 'ARG') earnings.ARG += amt;
      else if (adm === 'PERU') earnings.PERU += amt;
      else if (adm === 'USA') earnings.USA += amt;
    });

    // También sumar operaciones tipo 'ingreso' si existen (datos históricos u otras inserciones)
    const operations = _load('operations');
    operations.filter(o => o.tipo === 'ingreso' || o.type === 'income').forEach(o => {
      const adm = o.administration || o.administracion || o.adm || 'ARG';
      const amt = Number(o.monto || o.amount || 0) || 0;
      if (adm === 'ARG') earnings.ARG += amt;
      else if (adm === 'PERU') earnings.PERU += amt;
      else if (adm === 'USA') earnings.USA += amt;
    });

    const earningsARG = earnings.ARG;
    const earningsPERU = earnings.PERU;
    const earningsUSA = earnings.USA;
    const totalEarnings = earningsARG + earningsPERU + earningsUSA;

    const totalProjects = projects.length;
    const completedProjects = projects.filter(p => p.status === 'aprobado').length;

    const totalSpent = _load('expenses').reduce((s, r) => s + (Number(r.amount || r.monto || 0) || 0), 0);

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

  /** Ganancias por mes y administración (últimos 6 meses) */
  function getMonthlyData() {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }),
        earningsARG: 0,
        earningsPERU: 0,
        earningsUSA: 0
      });
    }
    // Aggregate from incomes collection and operations (tipo 'ingreso')
    const incomes = _load('incomes');
    const operations = _load('operations');

    const addToMonth = (dateStr, adm, amount) => {
      const key = (dateStr || '').slice(0, 7);
      const m = months.find(x => x.key === key);
      if (!m) return;
      if (adm === 'ARG') m.earningsARG += amount;
      else if (adm === 'PERU') m.earningsPERU += amount;
      else if (adm === 'USA') m.earningsUSA += amount;
    };

    incomes.forEach(r => {
      const amount = Number(r.amount || r.monto) || 0;
      const proj = _load('projects').find(p => p.id === r.projectId) || {};
      const adm = proj.administration || r.administration || r.currency || 'ARG';
      addToMonth(r.date || r.fecha || r.createdAt, adm, amount);
    });

    operations.filter(o => o.tipo === 'ingreso' || o.type === 'income').forEach(o => {
      const amount = Number(o.monto || o.amount) || 0;
      const adm = o.administration || o.administracion || o.adm || 'ARG';
      addToMonth(o.date || o.fecha || o.createdAt, adm, amount);
    });
    return months;
  }

  // ── Inicialización ────────────────────────────────────────────────────────
  function init() {
    if (!getConfig()) {
      setConfig({
        company: {
          name: 'Aurea Technical Art LLC',
          address: '2800 Glades Circle Suite 105',
          city: 'Weston 33327, Miami, FL US',
          email: 'aureatechnicalart@gmail.com',
          phone: '',
          taxId: 'ID 397310',
          logo: '',
        },
        administrations: {
          AR: { name: 'Argentina', currency: 'ARS', symbol: '$', flag: 'AR' },
          PE: { name: 'Perú', currency: 'PEN', symbol: 'S/', flag: 'PE' },
          US: { name: 'USA', currency: 'USD', symbol: '$', flag: 'US' }
        },
        categories: [
          'Produccion', 'Sonido', 'Iluminacion', 'Escenario', 'Transporte',
          'Personal', 'Alquileres', 'Materiales', 'Logistica', 'Otros',
        ],
        budgetCounter: 0,
        invoiceCounter: 0,
        projectCounter: 0,
      });
    }
    // Migración de estados de proyecto existentes → normalizar a 'pendiente'/'aprobado'
    try {
      const projs = _load('projects');
      projs.forEach(p => {
        const current = p.status || p.estado || '';
        if (current === 'aprobado' || current === 'pendiente') return;
        const mapped = (current === 'completado' || current === 'activo') ? 'aprobado' : 'pendiente';
        // Actualizar tanto 'status' como 'estado' para compatibilidad
        const upd = { ...(p || {}), status: mapped, estado: mapped };
        update('projects', p.id, upd);
      });
    } catch (e) { /* ignore migration errors */ }

    // Demo data si no hay proyectos
    if (!_load('projects').length) {
      const pid = _id();
      add('projects', {
        id: pid, 
        nombre: 'Proyecto Demo', 
        cliente: 'Cliente Ejemplo',
        administracion: 'US', 
        moneda: 'USD', 
        estado: 'aprobado',
        status: 'aprobado',
        fechaCreacion: new Date().toISOString(),
        fechaInicio: null,
        notas: 'Proyecto de demostración',
      });
      const bid = _id();
      add('budgets', {
        id: bid, 
        projectId: pid, 
        numero: 'BUDGET-001',
        status: 'aprobado-total', 
        fechaCreacion: new Date().toISOString(),
        fechaEnvio: new Date().toISOString(),
        fechaAprobacion: new Date().toISOString(),
        pagoRecibido: true,
        fechaPago: new Date().toISOString(),
        items: [
          { activity: 'Service', description: 'Producción general', qty: 1, rate: 5000, amount: 5000, aprobado: true },
          { activity: 'Service', description: 'Edición de video', qty: 10, rate: 150, amount: 1500, aprobado: true },
        ],
        subtotal: 6500,
        total: 6500,
        notas: 'Presupuesto de ejemplo aprobado',
      });
      add('operations', {
        projectId: pid, 
        budgetId: bid,
        fecha: new Date().toISOString().split('T')[0],
        tipo: 'gasto',
        categoria: 'Personal', 
        descripcion: 'Honorarios técnico', 
        monto: 800, 
        moneda: 'USD',
        registrado: true,
        notas: '',
      });
      add('templates', {
        nombre: 'Producción Estándar',
        categoria: 'produccion',
        items: [
          { activity: 'Service', description: 'Producción', qty: 1, rate: 5000, amount: 5000 }
        ]
      });
      setConfig({ ...getConfig(), budgetCounter: 1, projectCounter: 1 });
    }
  }

  return {
    getAll, get, add, update, remove,
    getConfig, setConfig, nextNumber, nextBudgetNumber,
    getBudgetsByProject, getOperationsByProject,
    getInvoicesByProject, getIncomesByProject, getExpensesByProject,
    getTemplates,
    getActiveBudget, getApprovedBudgetTotal,
    getProjectFinancials, getDashboardStats, getMonthlyData,
    init,
  };
})();
