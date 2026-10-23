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

  function saveProjectInvoice(projectId, invoiceId, data, expectedVersion) {
    const project = get('projects', projectId);
    if (!project || project.administration !== 'USA') throw new Error('Proyecto USA no encontrado.');
    const invoices = getInvoicesByProject(projectId);
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
    if (invoice) totals[invoice.id] = invoice.total;
    else delete totals[invoiceId];
    const previousInvoices = _load('invoices');
    const previousProjects = _load('projects');
    try {
      if (invoice) {
        if (invoiceId) update('invoices', invoiceId, invoice);
        else add('invoices', invoice);
      } else {
        remove('invoices', invoiceId);
      }
      update('projects', projectId, { invoiceTotals: totals, budgetAmount: Number(Object.values(totals).reduce((sum, total) => sum + total, 0).toFixed(2)) });
      return invoice;
    } catch (error) {
      _save('invoices', previousInvoices);
      _save('projects', previousProjects);
      throw error;
    }
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
  * Fecha opcional YYYY-MM-DD: reserva el correlativo de ese dia.
   */
  function nextBudgetNumber(date) {
    const now = date === undefined ? new Date() : new Date(`${date}T12:00:00`);
    if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(now.getTime()) ||
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` !== date)) {
      throw new Error('Seleccioná una fecha de factura válida.');
    }
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateKey = `${yy}${mm}${dd}`;
    
    const cfg = getConfig() || {};
    const budgetCounters = cfg.budgetCounters || {};
    const records = date === undefined ? [] : [...getAll('budgets'), ...getAll('invoices').flatMap(inv => [inv, ...(inv.history || [])])];
    const lastUsed = records.reduce((max, record) => {
      const number = String(record.number ?? record.invoiceNumber ?? record.budgetNumber ?? '').replace('-', '');
      return number.startsWith(dateKey) && /^\d{9,}$/.test(number) ? Math.max(max, Number(number.slice(6))) : max;
    }, 0);
    const dailyCounter = Math.max(budgetCounters[dateKey] || 0, lastUsed) + 1;
    
    budgetCounters[dateKey] = dailyCounter;
    setConfig({ ...cfg, budgetCounters });
    
    return `${yy}${mm}${dd}${String(dailyCounter).padStart(3, '0')}`;
  }

  // ── Queries helpers (filtros por proyecto) ───────────────────────────
  // Normalize administration/currency codes used across the app
  function _normalizeAdm(adm) {
    const s = String(adm || '').toUpperCase().trim();
    if (!s) return 'ARG';
    if (s === 'AR' || s === 'ARG' || s === 'ARS') return 'ARG';
    if (s === 'PE' || s === 'PERU' || s === 'PEN') return 'PERU';
    if (s === 'US' || s === 'USA' || s === 'USD') return 'USA';
    return s;
  }

  
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
   * getApprovedBudgetTotal - Calcula el total aprobado del presupuesto (RESPALDO)
   *
   * Esto ya NO es la fuente principal de "Presupuesto Aprobado" — ver el comentario en
   * getProjectFinancials más abajo. Solo se usa como respaldo para proyectos viejos que
   * todavía no tienen project.budgetAmount guardado. Se corrigió acá para que use los
   * mismos nombres de campo que el resto de la app (qty/unitPrice, no qty/rate, que no
   * existen en los items) y aplique el IVA/IGV en la aprobación parcial igual que en la
   * total — antes NO lo aplicaba, lo cual era parte del "lío con el IVA" reportado.
   *
   * IMPORTANTE:
   * - Si es aprobación TOTAL → Suma todo (budget.total, ya incluye IVA/IGV si corresponde)
   * - Si es aprobación PARCIAL → Suma solo los items con aprobado=true, aplicando el mismo
   *   IVA/IGV que el resto del presupuesto
   *
   * @param {object} budget - Presupuesto a calcular
   * @returns {number} Total aprobado
   */
  function getApprovedBudgetTotal(budget) {
    if (!budget) return 0;
    if (budget.status === 'aprobado-parcial') {
      const adm = String(budget.administration || '').toUpperCase();
      const ivaCon = adm === 'PERU' ? true : (adm === 'ARG' && budget.iva === 'con');
      const taxRate = ivaCon ? (adm === 'PERU' ? 0.18 : 0.21) : 0;
      const subtotal = (budget.items || [])
        .filter(item => item.aprobado === true)
        .reduce((sum, item) => sum + ((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)), 0);
      return Number((subtotal * (1 + taxRate)).toFixed(2));
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
    // Determine administration from project to apply correct tax rules
    const project = _load('projects').find(p => p.id === projectId) || {};
    const adm = _normalizeAdm(project.administration || project.administracion || project.adm || 'ARG');
    const totalIncomeGross = incomes.reduce((s, r) => s + (Number(r.amount || r.monto || 0) || 0), 0);
    const totalIncome = incomes.reduce((sum, income) => {
      const amount = Number(income.amount || income.monto || 0) || 0;
      let taxRate = 0;
      if (income.budgetId) {
        const linkedBudget = _load('budgets').find(b => b.id === income.budgetId);
        if (linkedBudget) {
          const budgetAdm = _normalizeAdm(linkedBudget.administration || linkedBudget.administracion || 'ARG');
          const includesTax = budgetAdm === 'PERU' || (budgetAdm === 'ARG' && linkedBudget.iva === 'con');
          taxRate = includesTax ? (budgetAdm === 'ARG' ? 0.21 : 0.18) : 0;
        }
      }
      return sum + (taxRate > 0 ? amount / (1 + taxRate) : amount);
    }, 0);
    const totalExpense = expenses.reduce((s, r) => s + (Number(r.amount || r.monto || 0) || 0), 0);
    const budget = getActiveBudget(projectId);
    // budgetTotal ("Presupuesto Aprobado"): se lee del PROYECTO (project.budgetAmount),
    // que queda congelado con el monto correcto (misma fórmula, mismo IVA/IGV) apenas se
    // aprueba un presupuesto — ver saveBudgetForm/approveBudget/createInvoiceFromBudget en
    // app.js. Antes esto se recalculaba ACÁ leyendo los items del presupuesto de nuevo
    // (getApprovedBudgetTotal), con su propia lógica de IVA y de nombres de campo — eso es
    // lo que generaba números distintos entre Proyectos, Administración/Inicio y la pestaña
    // Finanzas ("está tomando el IVA como parte del total" que reportó el cliente). Si el
    // proyecto todavía no tiene ese campo guardado (proyectos viejos, o sin presupuesto
    // vinculado), usamos el cálculo anterior como respaldo.
    const budgetTotal = (project.budgetAmount !== undefined && project.budgetAmount !== null)
      ? (Number(project.budgetAmount) || 0)
      : getApprovedBudgetTotal(budget);
    // Redondeamos "remaining" a un número entero de moneda local ACÁ, en el único lugar
    // donde se calcula. Así, la lista de Proyectos (que muestra cada fin.remaining por
    // fila) y Administraciones/Inicio (que SUMAN fin.remaining de todos los proyectos y
    // después redondean el total) parten siempre del mismo número entero, y la suma de
    // las filas coincide exacto con el total mostrado arriba. Sin este redondeo acá, el
    // presupuesto podía traer decimales (por el cálculo de IVA/IGV) y aparecía una
    // diferencia de $1 entre la lista y el total (suma de redondeados ≠ redondeo de la suma).
    const remaining = Math.round(budgetTotal - totalExpense);
    // Ganancia = Ingresos - Gastos para TODAS las administraciones (pedido del cliente).
    // Antes USA con facturación usaba lo facturado como base, y no coincidía con la columna
    // Ingresos (y daba -Gastos cuando se borraban las facturas).
    const profit = Math.round(totalIncome - totalExpense);
    const percentUsed = budgetTotal > 0 ? (totalExpense / budgetTotal) * 100 : 0;
    // Conversión a USD (moneda local por 1 USD). USA = 1 por defecto.
    // El tipo de cambio se carga en el PROYECTO (campo exchangeRateToUSD) — es la única
    // fuente que se usa acá. Ya no se lee ningún tipo de cambio guardado en el presupuesto.
    let rate = Number(project.exchangeRateToUSD);
    if (!isFinite(rate) || rate <= 0) rate = (adm === 'USA') ? 1 : 0;
    const profitUSD = rate > 0 ? (profit / rate) : 0;
    const budgetTotalUSD = rate > 0 ? (budgetTotal / rate) : 0;
    // remainingUSD: el "saldo" del proyecto (Presupuesto aprobado − Gastos) convertido a
    // dólares. Es lo que se usa para los gráficos (Inicio y Administraciones) — ver
    // getDashboardStats/getMonthlyData más abajo — porque representa un proyecto ya
    // confirmado (con presupuesto aprobado), a diferencia de profit/profitUSD que depende
    // de los Ingresos cargados a mano y puede no reflejar el total presupuestado todavía.
    const remainingUSD = rate > 0 ? (remaining / rate) : 0;
    return {
      totalIncome, // net (sin impuesto)
      totalIncomeGross,
      totalExpense,
      profit,
      budgetTotal,
      totalSpent: totalExpense,
      remaining,
      percentUsed,
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
    const projects = _load('projects').filter(project => _recordYear(project) === selectedYear);
    const budgets = _load('budgets').filter(budget => _recordYear(budget) === selectedYear);
    // Proyectos activos — aceptar variantes 'activo' o 'aprobado'
    const activeProjects = projects.filter(p => ['activo','aprobado'].includes(p.status)).length;

    // Presupuestos pendientes (aceptar variantes en inglés/español)
    const pendingStates = ['borrador','enviado','pending','draft'];
    const pendingBudgets = budgets.filter(b => pendingStates.includes((b.status||'').toString())).length;

    // Presupuestos cancelados (aceptar variantes)
    const cancelledStates = ['rechazado','cancelado','cancelled'];
    const cancelledBudgets = budgets.filter(b => cancelledStates.includes((b.status||'').toString())).length;

    // Ganancias por administración = suma de la ganancia neta de cada proyecto
    // (Ingresos sin IVA/IGV - Gastos). Los valores negativos se restan del total.
    const earnings = { ARG: 0, PERU: 0, USA: 0 };
    // Equivalente en USD por administración, usando el tipo de cambio cargado en cada
    // proyecto (campo exchangeRateToUSD del proyecto). Es lo que permite comparar
    // ARG/PERU/USA en el mismo gráfico aunque manejen montos muy distintos.
    const earningsUSDByAdmin = { ARG: 0, PERU: 0, USA: 0 };
    let earningsUSD = 0;

    projects.forEach(p => {
      try {
        const fin = getProjectFinancials(p.id);
        const adm = _normalizeAdm(p.administration || p.administracion || p.adm || 'ARG');
        const projectProfit = Number(fin.profit || 0) || 0;
        const projectProfitUSD = Number(fin.profitUSD || 0) || 0;
        if (adm === 'ARG') { earnings.ARG += projectProfit; earningsUSDByAdmin.ARG += projectProfitUSD; }
        else if (adm === 'PERU') { earnings.PERU += projectProfit; earningsUSDByAdmin.PERU += projectProfitUSD; }
        else if (adm === 'USA') { earnings.USA += projectProfit; earningsUSDByAdmin.USA += projectProfitUSD; }
        earningsUSD += projectProfitUSD;
      } catch (e) {
        console.warn('Error calculando finanzas de proyecto', p.id, e);
      }
    });

    const earningsARG = earnings.ARG;
    const earningsPERU = earnings.PERU;
    const earningsUSA = earnings.USA;
    // totalEarnings queda consolidado en USD — es la única moneda válida para sumar entre
    // administraciones (antes se sumaban pesos + soles + dólares directamente, lo cual no
    // tiene sentido: mezclaba unidades distintas en un mismo total).
    const totalEarnings = earningsUSD;

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
  * getMonthlyData - Ganancias por mes y administración (enero-diciembre), para Inicio.
  * Cada proyecto aporta su ganancia neta normalizada a USD con su tipo de cambio.
   * Un proyecto sin tipo de cambio cargado (ARG/PERU) queda afuera del cálculo hasta que
   * se le cargue el valor del dólar.
   */
  function getMonthlyData(year = new Date().getFullYear()) {
    const selectedYear = Number(year) || new Date().getFullYear();
    const monthlyData = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
      const d = new Date(selectedYear, monthIndex, 1);
      monthlyData.push({
        key: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
        label: d.toLocaleDateString('es-AR', { month: 'short' }),
        earningsARG: 0,
        earningsPERU: 0,
        earningsUSA: 0
      });
    }

    const projects = _load('projects').filter(project => _recordYear(project) === selectedYear);
    projects.forEach(project => {
      const rawDate = project.date || project.createdAt || project.created;
      const date = rawDate && typeof rawDate.toDate === 'function' ? rawDate.toDate() : rawDate;
      const key = date instanceof Date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        : String(date || '').slice(0, 7);
      const month = monthlyData.find(m => m.key === key);
      if (!month) return;
      const adm = _normalizeAdm(project.administration || project.administracion || project.adm || 'ARG');
      const usd = Number(getProjectFinancials(project.id).profitUSD || 0) || 0;
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
    getAll, get, add, update, remove, saveProjectInvoice,
    getConfig, setConfig, nextNumber, nextBudgetNumber,
    getBudgetsByProject, getOperationsByProject,
    getInvoicesByProject, getIncomesByProject, getExpensesByProject,
    getTemplates,
    getActiveBudget, getApprovedBudgetTotal,
    getProjectFinancials, getDashboardStats, getMonthlyData,
    init,
  };
})();