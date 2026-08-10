/**
 * Aurea App — Lógica principal
 * Módulos: Router · Dashboard · Proyectos · Presupuestos · Operaciones · Facturas · Seguimiento · Configuración
 * 
 * GUÍA RÁPIDA:
 * - Este archivo maneja toda la lógica de la app (routing, renderizado, eventos)
 * - Usa LocalStorage como base de datos (ver db.js)
 * - SPA con routing por hash (#/presupuestos, #/projects, etc.)
 * - Sin framework, vanilla JavaScript ES6+
 */
'use strict';

// ═══════════════════════════════════════════════════════════════
// CONSTANTES - Configuración global de administraciones y estados
// ═══════════════════════════════════════════════════════════════

/**
 * ADMIN - Configuración de las tres administraciones (ARG, PERU, USA)
 * 
 * IMPORTANTE:
 * - flagColor: Color que se usa en badges, PDFs y UI
 * - invoice: Si es true, puede generar INVOICE en lugar de FACTURA
 * - Los PDFs salen en INGLÉS solo si es USA, el resto en ESPAÑOL
 */
const ADMIN = {
  ARG:  { label: 'Argentina',       flag: 'AR', code: 'ARS', locale: 'es-AR', symbol: '$',  flagColor: '#0055A4', invoice: false },
  PERU: { label: 'Perú',            flag: 'PE', code: 'PEN', locale: 'es-PE', symbol: 'S/', flagColor: '#DC0000', invoice: false },
  USA:  { label: 'Estados Unidos',  flag: 'US', code: 'USD', locale: 'en-US', symbol: '$',  flagColor: '#008f82', invoice: true  },
};

/**
 * PROJECT_STATUS - Estados posibles de un proyecto
 */
const PROJECT_STATUS = {
  activo:     { label: 'Activo',      badge: 'badge-blue'   },
  pausado:    { label: 'Pausado',     badge: 'badge-yellow' },
  completado: { label: 'Completado',  badge: 'badge-green'  },
  cancelado:  { label: 'Cancelado',   badge: 'badge-red'    },
};

/**
 * BUDGET_STATUS - Estados del flujo de presupuestos
 * 
 * FLUJO TÍPICO:
 * 1. borrador → Estás armando el presupuesto
 * 2. enviado → Lo mandaste al cliente
 * 3. aprobado-total/parcial → Cliente aceptó (se crea proyecto automáticamente)
 * 4. rechazado/cancelado → No se aprobó
 * 
 * NOTA: Cuando cambiás a 'aprobado-parcial', aparecen checkboxes para marcar items
 */
const BUDGET_STATUS = {
  borrador:           { label: 'Borrador',           badge: 'badge-gray'   },
  enviado:            { label: 'Enviado',            badge: 'badge-blue'   },
  'aprobado-total':   { label: 'Aprobado Total',    badge: 'badge-green'  },
  'aprobado-parcial': { label: 'Aprobado Parcial',  badge: 'badge-yellow' },
  rechazado:          { label: 'Rechazado',          badge: 'badge-red'    },
  cancelado:          { label: 'Cancelado',          badge: 'badge-gray'   },
};

const INVOICE_STATUS = {
  borrador:  { label: 'Borrador',  badge: 'badge-gray'  },
  enviada:   { label: 'Enviada',   badge: 'badge-blue'  },
  pagada:    { label: 'Pagada',    badge: 'badge-green' },
};

// ═══════════════════════════════════════════════════════════════
// UTILIDADES - Funciones helper usadas en toda la app
// ═══════════════════════════════════════════════════════════════

/**
 * fmtCurrency - Formatea montos en la moneda correcta según administración
 * @param {number} amount - Monto a formatear
 * @param {string} adm - Código de administración ('ARG', 'PERU', 'USA') o código moneda
 * @returns {string} Monto formateado (ej: "$1,234.56" o "S/1,234.56")
 */
function fmtCurrency(amount, adm) {
  const a = ADMIN[adm] || ADMIN.ARG;
  try {
    return new Intl.NumberFormat(a.locale, { style: 'currency', currency: a.code, minimumFractionDigits: 2 }).format(Number(amount) || 0);
  } catch {
    return `${a.symbol}${(Number(amount) || 0).toLocaleString(a.locale, { minimumFractionDigits: 2 })}`;
  }
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    const [y,m,d] = str.split('-');
    return `${d}/${m}/${y}`;
  } catch { return str; }
}

function today() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function badge(status, map) {
  const s = map[status] || { label: status, badge: 'badge-gray' };
  return `<span class="badge ${s.badge}">${s.label}</span>`;
}

function adminBadge(adm) {
  const a = ADMIN[adm] || ADMIN.ARG;
  return `<span class="badge" style="background:#f1f5f9;color:#334155;gap:6px">
    <span style="background:${a.flagColor};color:#fff;padding:1px 5px;border-radius:4px;font-size:10px;font-weight:700;letter-spacing:.03em">${a.flag}</span>
    ${a.label} &middot; ${a.code}
  </span>`;
}

async function confirmDelete(name) {
  const r = await Swal.fire({
    title: '¿Eliminar?',
    html: `Se eliminará <b>${esc(name)}</b>. Esta acción no se puede deshacer.`,
    icon: 'warning', showCancelButton: true,
    confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar',
    confirmButtonColor: '#dc2626', cancelButtonColor: '#6b7280',
  });
  return r.isConfirmed;
}

function notify(msg, type = 'success') {
  Swal.fire({ toast: true, position: 'top-end', showConfirmButton: false,
    timer: 2800, timerProgressBar: true, icon: type, title: msg });
}

function setContent(html) {
  document.getElementById('main-content').innerHTML = html;
}

function setBreadcrumb(parts) {
  const el = document.getElementById('breadcrumb');
  if (!parts.length) { el.innerHTML = ''; return; }
  el.innerHTML = parts.map((p, i) => {
    if (i < parts.length - 1)
      return `<a class="cursor-pointer" style="color: #6b7280;" onmouseover="this.style.color='#de591f'" onmouseout="this.style.color='#6b7280'" onclick="navigate('${p.route}')">${esc(p.label)}</a><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;
    return `<span class="font-semibold text-gray-900">${esc(p.label)}</span>`;
  }).join('');
}

function setActions(html) {
  document.getElementById('header-actions').innerHTML = html;
}

let _dashChart = null;
function destroyChart() {
  if (_dashChart) { try { _dashChart.destroy(); } catch {} _dashChart = null; }
}

// ═══════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════
function navigate(path) {
  if (window.location.hash !== path) window.location.hash = path;
  else route(path);
}

function route(hash) {
  destroyChart();
  const h = hash || window.location.hash || '#/';
  const parts = h.split('/').filter(Boolean);
  const base = parts[0] || '#';

  // Update sidebar active
  document.querySelectorAll('.nav-item').forEach(el => {
    const dr = el.getAttribute('data-route');
    el.classList.toggle('active',
      dr === h ||
      (h.startsWith('#/projects') && dr === '#/projects') ||
      (h.startsWith('#/settings') && dr === '#/settings') ||
      (h.startsWith('#/presupuestos') && dr === '#/presupuestos')
    );
  });

  if (h === '#/' || h === '#') return renderDashboard();
  if (h === '#/projects') return renderProjects();
  if (h === '#/projects/new') return renderProjectForm(null);
  if (h === '#/presupuestos') return renderTracker();
  if (h === '#/presupuestos/new') return renderBudgetForm(null, null);
  if (h === '#/facturas') return renderAllInvoices();
  if (h === '#/administraciones') return renderAdministraciones();
  if (h.startsWith('#/settings')) return renderSettings(parts[2] || 'company');

  // #/presupuestos/:id
  if (parts[1] === 'presupuestos' && parts[2]) {
    return renderBudgetForm(null, parts[2]);
  }

  // #/projects/:id/...
  if (parts[1] === 'projects' && parts[2]) {
    const pid = parts[2];
    if (parts[3] === 'budgets' && parts[4]) {
      if (parts[4] === 'new') return renderBudgetForm(pid, null);
      return renderBudgetForm(pid, parts[4]);
    }
    if (parts[3] === 'invoices' && parts[4]) {
      if (parts[4] === 'new') return renderInvoiceForm(pid, null);
      return renderInvoiceForm(pid, parts[4]);
    }
    const tab = parts[3] || 'info';
    return renderProjectDetail(pid, tab);
  }

  renderDashboard();
}

window.addEventListener('hashchange', () => route(window.location.hash));

// ═══════════════════════════════════════════════════════════════
// MOBILE SIDEBAR
// ═══════════════════════════════════════════════════════════════
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('show');
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
function renderDashboard() {
  setBreadcrumb([{ label: 'Dashboard' }]);
  setActions('');
  const s = DB.getDashboardStats();
  const fmtRaw = n => `$${Number(n).toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0})}`;

  const kpis = [
    { label: 'Proyectos activos',       value: s.activeProjects,    icon: 'folder',  color: 'blue' },
    { label: 'Presupuestos pendientes', value: s.pendingBudgets,    icon: 'clock',   color: 'yellow' },
    { label: 'Presupuestos cancelados', value: s.cancelledBudgets,  icon: 'cancel',  color: 'red' },
    { label: 'Ganancias totales',       value: fmtRaw(s.totalEarnings), icon: 'dollar', color: 'green' },
  ];

  const kpiIconSVG = {
    folder: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7a2 2 0 012-2h3.28a2 2 0 011.664.89l.812 1.22A2 2 0 0012.28 8H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>`,
    clock:  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    check:  `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    cancel: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    dollar: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
    income: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>`,
    expense:`<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"/>`,
    profit: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>`,
  };

  const colorMap = {
    orange: 'bg-orange-100 text-orange-700',
    yellow: 'bg-yellow-100 text-yellow-600',
    green:  'bg-green-100 text-green-600',
    blue:   'bg-blue-100 text-blue-600',
    red:    'bg-red-100 text-red-600',
    emerald:'bg-emerald-100 text-emerald-600',
  };

  const kpiHTML = kpis.map(k => `
    <div class="kpi-card">
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm font-medium text-gray-500">${k.label}</p>
        <div class="w-9 h-9 rounded-xl ${colorMap[k.color]} flex items-center justify-center">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">${kpiIconSVG[k.icon]}</svg>
        </div>
      </div>
      <p class="text-2xl font-bold text-gray-900">${k.value}</p>
    </div>
  `).join('');

  // Recent projects
  const recentProjects = DB.getAll('projects').sort((a,b) => b.createdAt > a.createdAt ? 1 : -1).slice(0, 5);
  const recentHTML = recentProjects.length ? recentProjects.map(p => `
    <tr onclick="navigate('#/projects/${p.id}')" class="cursor-pointer">
      <td><span class="font-medium text-gray-900">${esc(p.name)}</span></td>
      <td class="text-gray-500">${esc(p.client || '—')}</td>
      <td>${adminBadge(p.administration)}</td>
      <td>${badge(p.status, PROJECT_STATUS)}</td>
      <td class="text-gray-500">${fmtDate(p.date)}</td>
    </tr>
  `).join('') : `<tr><td colspan="5" class="py-10 text-center text-gray-400">Sin proyectos aún</td></tr>`;

  setContent(`
    <div class="max-w-6xl mx-auto space-y-6">
      <!-- KPIs -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        ${kpiHTML}
      </div>

      <!-- Desglose de ganancias por administración -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 class="font-semibold text-gray-900 mb-4">Ganancias por Administración</h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div class="p-4 rounded-xl" style="background: ${ADMIN.ARG.flagColor}10; border: 2px solid ${ADMIN.ARG.flagColor}30">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: ${ADMIN.ARG.flagColor}; color: white; font-weight: 700; font-size: 14px;">${ADMIN.ARG.flag}</div>
              <div>
                <p class="text-xs font-semibold text-gray-500 uppercase">Argentina</p>
                <p class="text-xl font-bold" style="color: ${ADMIN.ARG.flagColor}">${fmtCurrency(s.earningsARG, 'ARG')}</p>
              </div>
            </div>
          </div>
          <div class="p-4 rounded-xl" style="background: ${ADMIN.PERU.flagColor}10; border: 2px solid ${ADMIN.PERU.flagColor}30">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: ${ADMIN.PERU.flagColor}; color: white; font-weight: 700; font-size: 14px;">${ADMIN.PERU.flag}</div>
              <div>
                <p class="text-xs font-semibold text-gray-500 uppercase">Perú</p>
                <p class="text-xl font-bold" style="color: ${ADMIN.PERU.flagColor}">${fmtCurrency(s.earningsPERU, 'PERU')}</p>
              </div>
            </div>
          </div>
          <div class="p-4 rounded-xl" style="background: ${ADMIN.USA.flagColor}10; border: 2px solid ${ADMIN.USA.flagColor}30">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: ${ADMIN.USA.flagColor}; color: white; font-weight: 700; font-size: 14px;">${ADMIN.USA.flag}</div>
              <div>
                <p class="text-xs font-semibold text-gray-500 uppercase">USA</p>
                <p class="text-xl font-bold" style="color: ${ADMIN.USA.flagColor}">${fmtCurrency(s.earningsUSA, 'USA')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <!-- Chart -->
        <div class="lg:col-span-3 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 class="font-semibold text-gray-900 mb-4">Ganancias — últimos 12 meses</h3>
          <canvas id="dash-chart" height="200"></canvas>
        </div>

        <!-- Recent projects -->
        <div class="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-6">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold text-gray-900">Últimos Proyectos</h3>
            <a onclick="navigate('#/projects')" class="text-sm font-medium cursor-pointer" style="color: #de591f;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">Ver todos →</a>
          </div>
          <div class="space-y-2">
            ${recentProjects.length ? recentProjects.map(p => `
              <div onclick="navigate('#/projects/${p.id}')" class="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 cursor-pointer border border-transparent hover:border-gray-100">
                <div>
                  <p class="text-sm font-semibold text-gray-900">${esc(p.name)}</p>
                  <p class="text-xs text-gray-400">${esc(p.client||'Sin cliente')} &middot; ${ADMIN[p.administration]?.code||''}</p>
                </div>
                ${badge(p.status, PROJECT_STATUS)}
              </div>
            `).join('') : '<p class="text-sm text-gray-400 text-center py-8">Sin proyectos</p>'}
          </div>
        </div>
      </div>
    </div>
  `);

  // Chart
  requestAnimationFrame(() => {
    const ctx = document.getElementById('dash-chart');
    if (!ctx) return;
    const months = DB.getMonthlyData();
    _dashChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label),
        datasets: [
          { label: 'Argentina', data: months.map(m => m.earningsARG), backgroundColor: ADMIN.ARG.flagColor + '80', borderColor: ADMIN.ARG.flagColor, borderWidth: 1.5, borderRadius: 6 },
          { label: 'Perú', data: months.map(m => m.earningsPERU), backgroundColor: ADMIN.PERU.flagColor + '80', borderColor: ADMIN.PERU.flagColor, borderWidth: 1.5, borderRadius: 6 },
          { label: 'USA', data: months.map(m => m.earningsUSA), backgroundColor: ADMIN.USA.flagColor + '80', borderColor: ADMIN.USA.flagColor, borderWidth: 1.5, borderRadius: 6 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, boxWidth: 12, boxHeight: 12 } } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Inter', size: 11 } } }
        }
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// PROYECTOS — LISTA
// ═══════════════════════════════════════════════════════════════
function renderProjects() {
  setBreadcrumb([{ label: 'Proyectos' }]);
  setActions(`<button class="btn btn-primary btn-sm" onclick="navigate('#/projects/new')">
    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
    Nuevo Proyecto
  </button>`);

  const projects = DB.getAll('projects').sort((a,b) => b.createdAt > a.createdAt ? 1 : -1);

  const rowsHTML = projects.length ? projects.map(p => {
    const fin = DB.getProjectFinancials(p.id);
    const adm = ADMIN[p.administration] || ADMIN.ARG;
    return `<tr onclick="navigate('#/projects/${p.id}')" class="cursor-pointer">
      <td>
        <div class="font-semibold text-gray-900">${esc(p.name)}</div>
        <div class="text-xs text-gray-400 mt-0.5">${esc(p.client||'—')}</div>
      </td>
      <td>${adminBadge(p.administration)}</td>
      <td>${badge(p.status, PROJECT_STATUS)}</td>
      <td class="text-gray-700 font-medium">${fmtCurrency(fin.totalIncome, p.administration)}</td>
      <td class="font-medium ${fin.profit >= 0 ? 'text-green-600' : 'text-red-600'}">${fmtCurrency(fin.profit, p.administration)}</td>
      <td class="text-gray-400">${fmtDate(p.date)}</td>
      <td>
        <div class="flex gap-2" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm btn-icon" title="Editar" onclick="showEditProject('${p.id}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" title="Eliminar" onclick="deleteProject('${p.id}','${esc(p.name)}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="7">
    <div class="empty-state">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7a2 2 0 012-2h3.28a2 2 0 011.664.89l.812 1.22A2 2 0 0012.28 8H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
      <p>No hay proyectos todavía</p>
      <small>Hacé clic en "Nuevo Proyecto" para empezar</small>
    </div>
  </td></tr>`;

  setContent(`
    <div class="max-w-6xl mx-auto">
      <!-- Filtros rápidos -->
      <div class="flex flex-wrap gap-3 mb-5 items-center">
        <input id="q-projects" type="text" placeholder="Buscar proyecto..." class="form-input" style="max-width:280px" oninput="filterProjects(this.value)">
        <select id="f-status" class="form-select" style="max-width:180px" onchange="filterProjects()">
          <option value="">Todos los estados</option>
          ${Object.entries(PROJECT_STATUS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
        <select id="f-admin" class="form-select" style="max-width:180px" onchange="filterProjects()">
          <option value="">Todas las administraciones</option>
          ${Object.entries(ADMIN).map(([k,v]) => `<option value="${k}">${v.flag} ${v.label}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table class="data-table" id="projects-table">
          <thead>
            <tr>
              <th>Proyecto</th>
              <th>Administración</th>
              <th>Estado</th>
              <th>Ingresos</th>
              <th>Ganancia</th>
              <th>Fecha</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody id="projects-body">${rowsHTML}</tbody>
        </table>
      </div>
    </div>
  `);
}

function filterProjects() {
  const q = (document.getElementById('q-projects')?.value || '').toLowerCase();
  const fst = document.getElementById('f-status')?.value || '';
  const fadm = document.getElementById('f-admin')?.value || '';
  const rows = document.querySelectorAll('#projects-body tr');
  rows.forEach(r => {
    const txt = r.textContent.toLowerCase();
    const matches = (!q || txt.includes(q)) &&
      (!fst || r.innerHTML.includes(`value="${fst}"`) || r.innerHTML.includes(PROJECT_STATUS[fst]?.label || '')) &&
      (!fadm || r.innerHTML.includes(ADMIN[fadm]?.label || ''));
    r.style.display = matches ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════
// PROYECTOS — FORMULARIO (crear / editar)
// ═══════════════════════════════════════════════════════════════
function renderProjectForm(id) {
  const project = id ? DB.get('projects', id) : null;
  const clients = DB.getAll('clients');
  const clientOpts = clients.map(c => `<option value="${esc(c.name)}" ${project?.client === c.name ? 'selected':''}>${esc(c.name)}</option>`).join('');

  Swal.fire({
    title: id ? 'Editar Proyecto' : 'Nuevo Proyecto',
    width: 560,
    html: `
      <div style="text-align:left">
        <div class="form-group">
          <label class="form-label">Nombre del proyecto *</label>
          <input id="pf-name" class="form-input" value="${esc(project?.name||'')}" placeholder="Ej: Video corporativo Acme">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="form-group">
            <label class="form-label">Cliente</label>
            <input id="pf-client" class="form-input" value="${esc(project?.client||'')}" placeholder="Nombre del cliente" list="client-list">
            <datalist id="client-list">${clientOpts}</datalist>
          </div>
          <div class="form-group">
            <label class="form-label">Fecha</label>
            <input id="pf-date" type="date" class="form-input" value="${project?.date || today()}">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="form-group">
            <label class="form-label">Administración *</label>
            <select id="pf-admin" class="form-select" onchange="updateCurrencyPreview()">
              ${Object.entries(ADMIN).map(([k,v]) => `<option value="${k}" ${project?.administration===k||(!project&&k==='ARG')?'selected':''}>${v.flag} ${v.label}</option>`).join('')}
            </select>
            <p class="text-xs text-gray-400 mt-1">Moneda: <b id="currency-preview">${ADMIN[project?.administration||'ARG'].code}</b></p>
          </div>
          <div class="form-group">
            <label class="form-label">Estado</label>
            <select id="pf-status" class="form-select">
              ${Object.entries(PROJECT_STATUS).map(([k,v]) => `<option value="${k}" ${project?.status===k||(!project&&k==='cotizacion')?'selected':''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Observaciones</label>
          <textarea id="pf-notes" class="form-textarea" rows="2" placeholder="Notas internas...">${esc(project?.notes||'')}</textarea>
        </div>
      </div>
    `,
    showCancelButton: true, confirmButtonText: id ? 'Guardar cambios' : 'Crear Proyecto',
    cancelButtonText: 'Cancelar', confirmButtonColor: '#f97316',
    didOpen: () => {
      window.updateCurrencyPreview = () => {
        const adm = document.getElementById('pf-admin').value;
        const el = document.getElementById('currency-preview');
        if (el) el.textContent = ADMIN[adm]?.code || '';
      };
    },
    preConfirm: () => {
      const name = document.getElementById('pf-name').value.trim();
      if (!name) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
      return {
        name, client: document.getElementById('pf-client').value.trim(),
        date: document.getElementById('pf-date').value,
        administration: document.getElementById('pf-admin').value,
        currency: ADMIN[document.getElementById('pf-admin').value]?.code || 'ARS',
        status: document.getElementById('pf-status').value,
        notes: document.getElementById('pf-notes').value.trim(),
      };
    }
  }).then(r => {
    if (!r.isConfirmed) return navigate(id ? `#/projects/${id}` : '#/projects');
    if (id) { DB.update('projects', id, r.value); notify('Proyecto actualizado'); navigate(`#/projects/${id}`); }
    else { const p = DB.add('projects', r.value); notify('Proyecto creado'); navigate(`#/projects/${p.id}`); }
  });
}

function showEditProject(id) {
  renderProjectForm(id);
}

async function deleteProject(id, name) {
  if (!await confirmDelete(name)) return;
  // Cascade delete
  DB.getBudgetsByProject(id).forEach(b => DB.remove('budgets', b.id));
  DB.getExpensesByProject(id).forEach(e => DB.remove('expenses', e.id));
  DB.getIncomesByProject(id).forEach(i => DB.remove('incomes', i.id));
  DB.getInvoicesByProject(id).forEach(i => DB.remove('invoices', i.id));
  DB.remove('projects', id);
  notify('Proyecto eliminado', 'info');
  renderProjects();
}

// ═══════════════════════════════════════════════════════════════
// PROYECTOS — DETALLE (tabs)
// ═══════════════════════════════════════════════════════════════
function renderProjectDetail(id, tab = 'info') {
  const project = DB.get('projects', id);
  if (!project) { notify('Proyecto no encontrado', 'error'); return navigate('#/projects'); }

  const adm = ADMIN[project.administration] || ADMIN.ARG;
  const showInvoices = adm.invoice;

  setBreadcrumb([
    { label: 'Proyectos', route: '#/projects' },
    { label: project.name },
  ]);
  setActions(`
    <button class="btn btn-secondary btn-sm" onclick="showEditProject('${id}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
      Editar
    </button>
  `);

  const tabs = [
    { key: 'info',       label: 'Informacion general' },
    { key: 'budgets',    label: 'Presupuesto' },
    { key: 'operations', label: 'Operaciones' },
    ...(showInvoices ? [{ key: 'invoices', label: 'Facturacion' }] : []),
    { key: 'documents',  label: 'Documentos' },
    { key: 'history',    label: 'Historial' },
  ];

  const tabBar = `<div class="tab-bar">${tabs.map(t => `
    <button class="tab-btn ${tab === t.key ? 'active' : ''}" onclick="navigate('#/projects/${id}/${t.key}')">${t.label}</button>
  `).join('')}</div>`;

  let content = '';
  if (tab === 'info')       content = renderTabInfo(project);
  if (tab === 'budgets')    content = renderTabBudgets(project);
  if (tab === 'operations') content = renderTabOperations(project);
  if (tab === 'invoices')   content = renderTabInvoices(project);
  if (tab === 'documents')  content = renderTabDocuments(project);
  if (tab === 'history')    content = renderTabHistory(project);
  if (!content)             content = renderTabInfo(project);

  setContent(`
    <div class="max-w-5xl mx-auto">
      <!-- Project header -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="flex items-center gap-3 flex-wrap">
              <h2 class="text-xl font-bold text-gray-900">${esc(project.name)}</h2>
              ${badge(project.status, PROJECT_STATUS)}
              ${adminBadge(project.administration)}
            </div>
            <p class="text-gray-500 text-sm mt-1">${esc(project.client||'Sin cliente')} · ${fmtDate(project.date)}</p>
          </div>
          <div class="flex gap-6 text-center">
            ${['totalIncome','totalExpense','profit'].map((k,i) => {
              const fin = DB.getProjectFinancials(id);
              const labels = ['Ingresos','Gastos','Ganancia'];
              const colors = ['text-green-600','text-red-600', fin.profit >= 0 ? 'text-green-600':'text-red-600'];
              return `<div><p class="text-xs text-gray-400 mb-1">${labels[i]}</p><p class="font-bold ${colors[i]}">${fmtCurrency(fin[k], project.administration)}</p></div>`;
            }).join('')}
          </div>
        </div>
      </div>

      ${tabBar}
      ${content}
    </div>
  `);
}

function renderTabInfo(p) {
  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
        <h3 class="font-semibold text-gray-900 border-b border-gray-100 pb-3">Datos del Proyecto</h3>
        ${[
          ['Nombre', p.name], ['Cliente', p.client||'—'], ['Fecha', fmtDate(p.date)],
          ['Estado', PROJECT_STATUS[p.status]?.label||p.status],
          ['Administración', `${ADMIN[p.administration]?.flag||''} ${ADMIN[p.administration]?.label||p.administration}`],
          ['Moneda', ADMIN[p.administration]?.code||'—'],
        ].map(([l,v]) => `
          <div class="flex justify-between items-center">
            <span class="text-sm text-gray-500">${l}</span>
            <span class="text-sm font-medium text-gray-900">${esc(v)}</span>
          </div>
        `).join('')}
      </div>
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 class="font-semibold text-gray-900 border-b border-gray-100 pb-3 mb-4">Observaciones</h3>
        <p class="text-sm text-gray-600 whitespace-pre-wrap">${esc(p.notes || 'Sin observaciones')}</p>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// PRESUPUESTOS (tab dentro de proyecto)
// ═══════════════════════════════════════════════════════════════
function renderTabBudgets(project) {
  const budgets = DB.getBudgetsByProject(project.id).sort((a,b) => (a.number||0) - (b.number||0));
  const rowsHTML = budgets.length ? budgets.map(b => {
    const total = calcBudgetTotal(b.items || []);
    return `<tr>
      <td class="font-medium text-gray-900">#${(typeof b.number === 'number' ? String(b.number).padStart(3,'0') : (b.number||b.budgetNumber||b.invoiceNumber||'(sin número)'))}</td>
      <td>${badge(b.status, BUDGET_STATUS)}</td>
      <td class="font-semibold text-gray-900">${fmtCurrency(total, project.administration)}</td>
      <td class="text-gray-400">${fmtDate(b.date)}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="navigate('#/projects/${project.id}/budgets/${b.id}')">Ver / Editar</button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="exportBudgetPDF('${b.id}')" title="PDF">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteBudget('${b.id}','${project.id}')" title="Eliminar">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="5"><div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p>Sin presupuestos</p><small>Creá el primer presupuesto para este proyecto</small></div></td></tr>`;

  return `
    <div class="flex justify-end mb-4">
      <button class="btn btn-primary btn-sm" onclick="navigate('#/projects/${project.id}/budgets/new')">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Nuevo Presupuesto
      </button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Número</th><th>Estado</th><th>Total</th><th>Fecha</th><th></th></tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// PRESUPUESTO — FORMULARIO COMPLETO
// ═══════════════════════════════════════════════════════════════
function calcBudgetTotal(items) {
  return items.reduce((s, it) => s + ((Number(it.qty)||0) * (Number(it.unitPrice)||0)), 0);
}

function calcApprovedTotal(items) {
  return items.filter(it => it.aprobado).reduce((s, it) => s + ((Number(it.qty)||0) * (Number(it.unitPrice)||0)), 0);
}

function renderBudgetForm(projectId, budgetId) {
  const project = projectId ? DB.get('projects', projectId) : null;
  const budget = budgetId ? DB.get('budgets', budgetId) : null;
  
  // Si hay presupuesto pero no proyecto, buscar si se creó el proyecto después
  let existingProject = project;
  if (budget && !existingProject && budget.projectId) {
    existingProject = DB.get('projects', budget.projectId);
  }
  
  const adm = (existingProject ? ADMIN[existingProject.administration] : (budget ? ADMIN[budget.administration] : null)) || ADMIN.ARG;
  const num = budget?.number ?? budget?.budgetNumber ?? '(nuevo)';
  const hasProject = !!existingProject;

  setBreadcrumb([
    { label: 'Presupuestos', route: '#/presupuestos' },
    { label: `Presupuesto #${(typeof num === 'number' ? String(num).padStart(3,'0') : String(num))}` },
  ]);
  
  const canApprove = budget && ['enviado', 'borrador'].includes(budget.status) && !existingProject;
  const isApproved = false; // Budgets can always be edited, even when approved
  
  setActions(`
    <button class="btn btn-secondary btn-sm" onclick="navigate('#/presupuestos')">← Volver</button>
    ${budget ? `<button class="btn btn-secondary btn-sm" onclick="exportBudgetPDF('${budgetId}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      PDF
    </button>` : ''}
    ${canApprove ? `<button class="btn btn-primary btn-sm" onclick="showApprovalModal('${budgetId}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      Aprobar Presupuesto
    </button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="saveBudgetForm('${projectId||''}','${budgetId||''}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
      Guardar
    </button>
  `);

  const items = budget?.items || [{ description: '', qty: 1, unit: '', unitPrice: 0, aprobado: false }];
  const statusOpts = Object.entries(BUDGET_STATUS).map(([k,v]) =>
    `<option value="${k}" ${(budget?.status||'borrador')===k?'selected':''}>${v.label}</option>`).join('');

  const renderRows = (its) => its.map((it, i) => {
    const isReadOnly = isApproved;
    const showApprovalCol = budget && budget.status !== 'borrador';
    return `
    <tr id="li-row-${i}">
      ${showApprovalCol ? `<td style="text-align:center;width:60px">
        <input type="checkbox" ${it.aprobado ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} onchange="toggleItemApproval(${i})" style="width:18px;height:18px;cursor:pointer">
      </td>` : ''}
      <td><input type="text" placeholder="Descripción del ítem" value="${esc(it.description||'')}" oninput="updateLiRow(${i})" ${isReadOnly ? 'disabled' : ''}></td>
      <td style="width:80px"><input type="number" min="0" value="${it.qty||1}" oninput="updateLiRow(${i})" id="li-qty-${i}" ${isReadOnly ? 'disabled' : ''}></td>
      <td style="width:100px"><input type="text" placeholder="unidad" value="${esc(it.unit||'')}" oninput="updateLiRow(${i})" ${isReadOnly ? 'disabled' : ''}></td>
      <td style="width:130px"><input type="number" min="0" step="0.01" value="${it.unitPrice||0}" oninput="updateLiRow(${i})" id="li-up-${i}" ${isReadOnly ? 'disabled' : ''}></td>
      <td style="width:150px;text-align:right;padding-right:12px;font-weight:600;color:#374151" id="li-total-${i}">${fmtCurrency((it.qty||1)*(it.unitPrice||0), budget?.administration || adm.code.slice(0, -1))}</td>
      ${!isReadOnly ? `<td style="width:40px">
        <button onclick="removeLiRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </td>` : '<td></td>'}
    </tr>
  `}).join('');

  const history = budget?.history || [];
  const historyHTML = history.length ? history.map(h => `
    <div class="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
      <div class="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0"></div>
      <div class="flex-1">
        <p class="text-sm font-medium text-gray-900">${esc(h.action)}</p>
        <p class="text-xs text-gray-500">${fmtDate(h.date)} ${h.time || ''}</p>
        ${h.notes ? `<p class="text-xs text-gray-600 mt-1">${esc(h.notes)}</p>` : ''}
      </div>
    </div>
  `).join('') : '<p class="text-sm text-gray-400 text-center py-4">Sin historial</p>';

  const totalAprobado = calcApprovedTotal(items);
  const total = calcBudgetTotal(items);
  const showApprovalCol = budget && budget.status !== 'borrador';

  setContent(`
    <div class="max-w-5xl mx-auto space-y-6" id="budget-form-wrap">
      ${budget && ['aprobado-total', 'aprobado-parcial'].includes(budget.status) ? `
        <div class="bg-green-50 border border-green-200 rounded-2xl p-4">
          <div class="flex items-center gap-3">
            <svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            <div>
              <p class="text-sm font-semibold text-green-800">Presupuesto ${budget.status === 'aprobado-total' ? 'Totalmente Aprobado' : 'Parcialmente Aprobado'}</p>
              <p class="text-xs text-green-600">Este presupuesto está aprobado${existingProject ? ' y tiene un proyecto asociado' : ''}. Los cambios se reflejarán en el proyecto.</p>
              ${existingProject ? `<a onclick="navigate('#/projects/${existingProject.id}')" class="text-xs text-green-700 font-semibold underline cursor-pointer mt-1 inline-block">Ver proyecto →</a>` : ''}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Header info -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          ${!hasProject ? `
          <div class="form-group mb-0">
            <label class="form-label">Nombre del Proyecto *</label>
            <input id="b-project-name" class="form-input" value="${esc(budget?.projectName||'')}" placeholder="Ej: Evento Corporativo 2026">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Cliente *</label>
            <input id="b-client" class="form-input" value="${esc(budget?.clientName||'')}" placeholder="Nombre del cliente">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Administración *</label>
            <select id="b-admin" class="form-select">
              ${Object.entries(ADMIN).map(([k,v]) => `<option value="${k}" ${(budget?.administration||'ARG')===k?'selected':''}>${v.flag} ${v.label} (${v.code})</option>`).join('')}
            </select>
          </div>
          ` : `
          <div class="form-group mb-0">
            <label class="form-label">Proyecto</label>
            <p class="text-sm font-medium text-gray-700">${esc(existingProject.name)}</p>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Cliente</label>
            <p class="text-sm font-medium text-gray-700">${esc(existingProject.client||'—')}</p>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Administración</label>
            <p class="text-sm font-medium text-gray-700">${adm.flag} ${adm.label}</p>
          </div>
          `}
          <div class="form-group mb-0">
            <label class="form-label">Fecha del Presupuesto</label>
            <input id="b-date" type="date" class="form-input" value="${budget?.date||today()}">
          </div>
        </div>
        ${!hasProject ? `
        <div class="mt-4">
          <div class="form-group mb-0">
            <label class="form-label">Estado</label>
            <select id="b-status" class="form-select">${statusOpts}</select>
          </div>
        </div>
        ` : `
        <div class="mt-4">
          <div class="form-group mb-0">
            <label class="form-label">Estado</label>
            <select id="b-status" class="form-select">${statusOpts}</select>
          </div>
        </div>
        `}
      </div>

      <!-- Line items -->
      <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div class="p-4 border-b border-gray-100 flex items-center justify-between" style="background: #F9F9F9">
          <h3 class="font-semibold text-gray-900">Ítems del Presupuesto</h3>
          <span class="text-xs font-semibold admin-badge" style="color: ${adm.flagColor}">${adm.flag} ${adm.label} · ${adm.code}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="li-table w-full" id="li-table">
            <thead>
              <tr style="background: #F9F9F9">
                ${showApprovalCol ? '<th style="width:60px;text-align:center">✓ Aprobado</th>' : ''}
                <th style="min-width:200px">Descripción</th>
                <th style="width:80px">Cant.</th>
                <th style="width:100px">Unidad</th>
                <th style="width:130px">P. Unitario</th>
                <th style="width:150px;text-align:right;padding-right:12px">Total</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="li-tbody">${renderRows(items)}</tbody>
          </table>
        </div>
        <div class="p-4 border-t border-gray-100 flex items-center justify-between" style="background: #F9F9F9">
          ${!isApproved ? `<button onclick="addLiRow()" class="btn btn-secondary btn-sm">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Agregar ítem
          </button>` : '<div></div>'}
          <div class="text-right">
            ${showApprovalCol && totalAprobado < total ? `
              <div class="mb-2">
                <p class="text-xs text-gray-500">Aprobado parcial</p>
                <p class="text-lg font-semibold text-yellow-600" id="b-approved-total">${fmtCurrency(totalAprobado, budget?.administration || 'ARG')}</p>
              </div>
            ` : ''}
            <p class="text-xs text-gray-500 mb-1">TOTAL PRESUPUESTO</p>
            <p class="text-2xl font-bold text-gray-900" id="b-total">${fmtCurrency(total, budget?.administration || 'ARG')}</p>
          </div>
        </div>
      </div>

      <!-- Notes -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <label class="form-label">Notas / Condiciones / Observaciones</label>
        <textarea id="b-notes" class="form-textarea" rows="4" placeholder="Ej: Condiciones de pago, vigencia del presupuesto, garantías, observaciones especiales..." ${isApproved ? 'disabled' : ''}>${esc(budget?.notes||'')}</textarea>
      </div>

      ${budget ? `
      <!-- Historial -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 class="font-semibold text-gray-900 mb-4">Historial de Cambios</h3>
        <div class="space-y-2">
          ${historyHTML}
        </div>
      </div>
      ` : ''}
    </div>
  `);

  // Keep track of items in JS
  window._budgetProjectId = projectId;
  window._budgetAdm = budget?.administration || adm.code.slice(0, -1);
  window._liItems = items.map(it => ({ ...it }));
  window._budgetIsApproved = false; // Always allow editing
  window._currentBudgetStatus = budget?.status || 'borrador';
  window._budgetHasProject = !!existingProject;

  // Update administration badge when select changes
  const adminSelect = document.getElementById('b-admin');
  if (adminSelect) {
    adminSelect.addEventListener('change', (e) => {
      const selectedAdm = ADMIN[e.target.value];
      window._budgetAdm = e.target.value;
      const badge = document.querySelector('.admin-badge');
      if (badge && selectedAdm) {
        badge.innerHTML = `${selectedAdm.flag} ${selectedAdm.label} · ${selectedAdm.code}`;
        badge.style.color = selectedAdm.flagColor;
      }
      rebuildLiTable();
    });
  }

  // Update checkboxes when status changes
  const statusSelect = document.getElementById('b-status');
  if (statusSelect) {
    statusSelect.addEventListener('change', (e) => {
      window._currentBudgetStatus = e.target.value;
      rebuildLiTable();
    });
  }

  window.toggleItemApproval = (i) => {
    window._liItems[i].aprobado = !window._liItems[i].aprobado;
    updateTotals();
  };

  window.updateLiRow = (i) => {
    const rows = document.querySelectorAll('#li-tbody tr');
    const row = rows[i];
    if (!row) return;
    const inputs = row.querySelectorAll('input');
    const currentStatus = window._currentBudgetStatus || 'borrador';
    const offset = currentStatus !== 'borrador' ? 1 : 0;
    window._liItems[i] = {
      ...window._liItems[i],
      description: inputs[offset].value,
      qty: Number(inputs[offset+1].value) || 0,
      unit: inputs[offset+2].value,
      unitPrice: Number(inputs[offset+3].value) || 0,
    };
    const total = (window._liItems[i].qty) * (window._liItems[i].unitPrice);
    document.getElementById(`li-total-${i}`).textContent = fmtCurrency(total, window._budgetAdm);
    updateTotals();
  };

  window.addLiRow = () => {
    if (window._budgetIsApproved) return;
    window._liItems.push({ description: '', qty: 1, unit: '', unitPrice: 0, aprobado: false });
    rebuildLiTable();
  };

  window.removeLiRow = (i) => {
    if (window._budgetIsApproved) return;
    window._liItems.splice(i, 1);
    rebuildLiTable();
  };

  function updateTotals() {
    const grand = calcBudgetTotal(window._liItems);
    const approved = calcApprovedTotal(window._liItems);
    const currentStatus = window._currentBudgetStatus || 'borrador';
    const showApprovalCol = currentStatus !== 'borrador';
    
    document.getElementById('b-total').textContent = fmtCurrency(grand, window._budgetAdm);
    
    // Update or create the approved total section
    const footerRight = document.querySelector('#li-table').closest('div').querySelector('.p-4.border-t .text-right');
    if (footerRight) {
      if (showApprovalCol && approved > 0 && approved < grand) {
        // Show partial approval total
        footerRight.innerHTML = `
          <div class="mb-2">
            <p class="text-xs text-gray-500">Aprobado parcial</p>
            <p class="text-lg font-semibold text-yellow-600" id="b-approved-total">${fmtCurrency(approved, window._budgetAdm)}</p>
          </div>
          <p class="text-xs text-gray-500 mb-1">TOTAL PRESUPUESTO</p>
          <p class="text-2xl font-bold text-gray-900" id="b-total">${fmtCurrency(grand, window._budgetAdm)}</p>
        `;
      } else {
        // Show only total
        footerRight.innerHTML = `
          <p class="text-xs text-gray-500 mb-1">TOTAL PRESUPUESTO</p>
          <p class="text-2xl font-bold text-gray-900" id="b-total">${fmtCurrency(grand, window._budgetAdm)}</p>
        `;
      }
    }
  }

  function rebuildLiTable() {
    const tbody = document.getElementById('li-tbody');
    const currentStatus = window._currentBudgetStatus || 'borrador';
    const showApprovalCol = currentStatus !== 'borrador';
    
    tbody.innerHTML = window._liItems.map((it, i) => {
      const isReadOnly = window._budgetIsApproved;
      return `
      <tr id="li-row-${i}">
        ${showApprovalCol ? `<td style="text-align:center;width:60px">
          <input type="checkbox" ${it.aprobado ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''} onchange="toggleItemApproval(${i})" style="width:18px;height:18px;cursor:pointer">
        </td>` : ''}
        <td><input type="text" placeholder="Descripción del ítem" value="${esc(it.description||'')}" oninput="updateLiRow(${i})" ${isReadOnly ? 'disabled' : ''}></td>
        <td><input type="number" min="0" value="${it.qty||1}" oninput="updateLiRow(${i})" id="li-qty-${i}" ${isReadOnly ? 'disabled' : ''}></td>
        <td><input type="text" placeholder="unidad" value="${esc(it.unit||'')}" oninput="updateLiRow(${i})" ${isReadOnly ? 'disabled' : ''}></td>
        <td><input type="number" min="0" step="0.01" value="${it.unitPrice||0}" oninput="updateLiRow(${i})" id="li-up-${i}" ${isReadOnly ? 'disabled' : ''}></td>
        <td style="text-align:right;padding-right:12px;font-weight:600;color:#374151" id="li-total-${i}">${fmtCurrency((it.qty||1)*(it.unitPrice||0), window._budgetAdm)}</td>
        ${!isReadOnly ? `<td><button onclick="removeLiRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td>` : '<td></td>'}
      </tr>
    `}).join('');
    
    // Update table headers
    const thead = document.querySelector('#li-table thead tr');
    if (thead) {
      thead.innerHTML = `
        ${showApprovalCol ? '<th style="width:60px;text-align:center">✓ Aprobado</th>' : ''}
        <th style="min-width:200px">Descripción</th>
        <th style="width:80px">Cant.</th>
        <th style="width:100px">Unidad</th>
        <th style="width:130px">P. Unitario</th>
        <th style="width:150px;text-align:right;padding-right:12px">Total</th>
        <th style="width:40px"></th>
      `;
    }
    
    updateTotals();
  }
}

/**
 * showApprovalModal - Modal para aprobar presupuestos (Total o Parcial)
 * 
 * IMPORTANTE: Esta función crea automáticamente:
 * 1. Un proyecto nuevo con los datos del presupuesto
 * 2. Un ingreso (income) con el monto aprobado
 * 3. Vincula el presupuesto al proyecto (projectId)
 * 
 * FLUJO:
 * - Aprobación Total: Se marca todo como aprobado, se registra monto total
 * - Aprobación Parcial: Solo items marcados, se registra monto parcial
 */
window.showApprovalModal = async function(budgetId) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) return;
  
  // Si ya tiene proyecto, no podemos aprobar de nuevo
  const existingProject = budget.projectId ? DB.get('projects', budget.projectId) : null;
  if (existingProject) {
    Swal.fire('Error', 'Este presupuesto ya tiene un proyecto asociado', 'error');
    return;
  }
  
  const total = calcBudgetTotal(budget.items || []);
  const adm = ADMIN[budget.administration || 'ARG'];

  const result = await Swal.fire({
    title: 'Aprobar Presupuesto',
    html: `
      <div class="text-left space-y-4" style="font-family: inherit;">
        <p class="text-sm text-gray-600">Al aprobar este presupuesto, se creará automáticamente un proyecto activo.</p>
        <div class="bg-gray-50 p-4 rounded-lg">
          <p class="text-xs text-gray-500 mb-1">Total del presupuesto</p>
          <p class="text-2xl font-bold text-gray-900">${fmtCurrency(total, adm.code)}</p>
        </div>
        <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p class="text-xs text-blue-800"><strong>Proyecto:</strong> ${esc(budget.projectName || '')}</p>
          <p class="text-xs text-blue-800"><strong>Cliente:</strong> ${esc(budget.clientName || '')}</p>
          <p class="text-xs text-blue-800"><strong>Administración:</strong> ${adm.flag} ${adm.label}</p>
        </div>
        <div class="form-group">
          <label class="form-label">Tipo de aprobación</label>
          <select id="approval-type" class="form-select">
            <option value="aprobado-total">Aprobación Total</option>
            <option value="aprobado-parcial">Aprobación Parcial (seleccionar ítems)</option>
          </select>
        </div>
        <div id="partial-info" style="display:none" class="bg-yellow-50 border border-yellow-200 p-3 rounded-lg">
          <p class="text-xs text-yellow-800">Con aprobación parcial, marca los ítems aprobados usando los checkboxes en la tabla del presupuesto.</p>
        </div>
        <div class="form-group">
          <label class="form-label">Notas (opcional)</label>
          <textarea id="approval-notes" class="form-textarea" rows="2" placeholder="Observaciones sobre la aprobación..."></textarea>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Aprobar y Crear Proyecto',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a',
    cancelButtonColor: '#6b7280',
    didOpen: () => {
      document.getElementById('approval-type').addEventListener('change', (e) => {
        document.getElementById('partial-info').style.display = e.target.value === 'aprobado-parcial' ? 'block' : 'none';
      });
    },
    preConfirm: () => {
      return {
        type: document.getElementById('approval-type').value,
        notes: document.getElementById('approval-notes').value
      };
    }
  });

  if (result.isConfirmed) {
    const approvalType = result.value.type;
    const approvalNotes = result.value.notes;
    
    if (approvalType === 'aprobado-parcial') {
      // Check at least one item is marked as approved
      const updatedItems = (window._liItems || budget.items).map(it => ({ ...it, aprobado: it.aprobado || false }));
      const approvedTotal = calcApprovedTotal(updatedItems);
      
      if (approvedTotal === 0) {
        Swal.fire('Error', 'Debe marcar al menos un ítem como aprobado para aprobación parcial', 'error');
        return;
      }
      budget.items = updatedItems;
    } else {
      // For total approval, mark all items as approved
      budget.items = budget.items.map(it => ({ ...it, aprobado: true }));
    }

    const now = new Date();
    const history = budget.history || [];
    history.push({
      action: approvalType === 'aprobado-total' ? 'Presupuesto Aprobado Totalmente' : 'Presupuesto Aprobado Parcialmente',
      date: today(),
      time: now.toLocaleTimeString('es-AR'),
      notes: approvalNotes || ''
    });

    // Create new project from budget
    const approvedAmount = approvalType === 'aprobado-total' ? total : calcApprovedTotal(budget.items);
    const projNum = DB.nextNumber('projectCounter');
    const newProject = DB.add('projects', {
      name: budget.projectName,
      client: budget.clientName,
      administration: budget.administration,
      status: 'activo',
      date: today(),
      budgetId: budgetId,
      budgetAmount: approvedAmount,
      number: projNum
    });

    // Automatically create income entry for approved amount
    const incomeDescription = approvalType === 'aprobado-total' 
      ? `Presupuesto aprobado totalmente - ${budget.number}` 
      : `Presupuesto aprobado parcialmente - ${budget.number}`;
    
    DB.add('incomes', {
      projectId: newProject.id,
      budgetId: budgetId,
      date: budget.date || today(),
      description: incomeDescription,
      amount: approvedAmount,
    });

    // Link budget to project
    DB.update('budgets', budgetId, { 
      status: approvalType,
      items: budget.items,
      history,
      projectId: newProject.id
    });

    notify('Presupuesto aprobado y proyecto creado', 'success');
    navigate('#/projects/' + newProject.id);
  }
};

/**
 * saveBudgetForm - Guarda presupuesto nuevo o actualiza existente
 * 
 * VALIDACIÓN IMPORTANTE:
 * - Si el presupuesto NO tiene proyecto asociado → Pide nombre proyecto, cliente, administración
 * - Si el presupuesto YA tiene proyecto → NO valida campos (evita bug "nombre obligatorio")
 * 
 * DATOS QUE SE GUARDAN:
 * - Standalone: projectName, clientName, administration (presupuesto sin proyecto)
 * - Con proyecto: projectId (presupuesto vinculado a proyecto existente)
 * - Común: date, status, notes, items, total, history
 */
window.saveBudgetForm = function(projectId, budgetId) {
  const date = document.getElementById('b-date')?.value || today();
  const status = document.getElementById('b-status')?.value || 'borrador';
  const notes = document.getElementById('b-notes')?.value || '';
  const items = (window._liItems || []).filter(it => it.description || it.unitPrice);
  const total = calcBudgetTotal(items);

  if (!items.length) { notify('Agregá al menos un ítem', 'warning'); return; }

  let data = { date, status, notes, items, total };

  // Check if this budget has an associated project (either from parameter or previously approved)
  const hasAssociatedProject = !!projectId || window._budgetHasProject;

  // Si no hay proyecto asociado, necesitamos los datos del presupuesto
  if (!hasAssociatedProject) {
    const projectName = document.getElementById('b-project-name')?.value.trim();
    const clientName = document.getElementById('b-client')?.value.trim();
    const administration = document.getElementById('b-admin')?.value;

    if (!projectName) { notify('El nombre del proyecto es obligatorio', 'warning'); return; }
    if (!clientName) { notify('El nombre del cliente es obligatorio', 'warning'); return; }

    data.projectName = projectName;
    data.clientName = clientName;
    data.administration = administration;
  } else if (projectId) {
    data.projectId = projectId;
  }
  
  // Keep existing projectId if budget was already approved
  if (budgetId) {
    const existingBudget = DB.get('budgets', budgetId);
    if (existingBudget?.projectId) {
      data.projectId = existingBudget.projectId;
    }
  }

  if (budgetId) {
    const existingBudget = DB.get('budgets', budgetId);
    const history = existingBudget?.history || [];
    
    // Add history entry for edits
    const now = new Date();
    const oldStatus = existingBudget?.status || 'borrador';
    if (oldStatus !== status) {
      history.push({
        action: `Estado cambiado: ${BUDGET_STATUS[oldStatus]?.label || oldStatus} → ${BUDGET_STATUS[status]?.label || status}`,
        date: today(),
        time: now.toLocaleTimeString('es-AR'),
        notes: ''
      });
    } else {
      history.push({
        action: 'Presupuesto modificado',
        date: today(),
        time: now.toLocaleTimeString('es-AR'),
        notes: 'Cambios guardados'
      });
    }
    
    data.history = history;
    DB.update('budgets', budgetId, data);
    notify('Presupuesto guardado');
    navigate('#/presupuestos');
  } else {
    const num = DB.nextBudgetNumber();
    const now = new Date();
    data.number = num;
    data.history = [{
      action: 'Presupuesto creado',
      date: today(),
      time: now.toLocaleTimeString('es-AR'),
      notes: 'Presupuesto inicial'
    }];
    const newBudget = DB.add('budgets', data);
    notify('Presupuesto creado exitosamente');
    navigate('#/presupuestos/' + newBudget.id);
  }
};

window.approveBudget = function(budgetId, projectId) {
  const budget = DB.get('budgets', budgetId);
  const project = DB.get('projects', projectId);
  if (!budget || !project) return;
  DB.update('budgets', budgetId, { status: 'aprobado' });
  // Auto-income
  const existing = DB.getIncomesByProject(projectId).find(i => i.budgetId === budgetId);
  if (!existing) {
    DB.add('incomes', {
      projectId, budgetId,
      date: budget.date || today(),
      description: `Presupuesto aprobado #${(typeof budget.number === 'number' ? String(budget.number).padStart(3,'0') : (budget.number||budget.budgetNumber||''))}`,
      amount: calcBudgetTotal(budget.items || []),
    });
  }
  // Update budget status in form
  document.getElementById('b-status').value = 'aprobado';
  notify('¡Presupuesto aprobado! Se registró el ingreso en Operaciones');
  renderBudgetForm(projectId, budgetId);
};

async function deleteBudget(id, projectId) {
  const bn = DB.get('budgets',id);
  const bnum = bn?.number ?? bn?.budgetNumber ?? '';
  if (!await confirmDelete(`Presupuesto #${(typeof bnum === 'number' ? String(bnum).padStart(3,'0') : String(bnum))}`)) return;
  // Remove associated income if any
  DB.getIncomesByProject(projectId).filter(i => i.budgetId === id).forEach(i => DB.remove('incomes', i.id));
  DB.remove('budgets', id);
  notify('Presupuesto eliminado', 'info');
  renderProjectDetail(projectId, 'budgets');
}

// ═══════════════════════════════════════════════════════════════
// OPERACIONES (tab)
// ═══════════════════════════════════════════════════════════════
function renderTabOperations(project) {
  const fin = DB.getProjectFinancials(project.id);
  const expenses = DB.getExpensesByProject(project.id).sort((a,b) => b.date > a.date ? 1 : -1);
  const incomes  = DB.getIncomesByProject(project.id).sort((a,b) => b.date > a.date ? 1 : -1);
  const cfg = DB.getConfig() || {};
  const cats = cfg.categories || [];

  const expRows = expenses.length ? expenses.map(e => `
    <tr>
      <td class="text-gray-500">${fmtDate(e.date)}</td>
      <td><span class="badge badge-orange">${esc(e.category)}</span></td>
      <td class="text-gray-700">${esc(e.description)}</td>
      <td class="font-semibold text-red-600">-${fmtCurrency(e.amount, project.administration)}</td>
      <td class="text-gray-400 text-xs">${esc(e.notes||'')}</td>
      <td>
        <div class="flex gap-1">
          <button class="btn btn-secondary btn-sm btn-icon" onclick="showExpenseModal('${project.id}','${e.id}')">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteExpense('${e.id}','${project.id}')">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="6" class="py-8 text-center text-gray-400 text-sm">Sin gastos registrados</td></tr>`;

  const incRows = incomes.length ? incomes.map(i => `
    <tr>
      <td class="text-gray-500">${fmtDate(i.date)}</td>
      <td class="text-gray-700">${esc(i.description)}</td>
      <td class="font-semibold text-green-600">${fmtCurrency(i.amount, project.administration)}</td>
      <td>
        <div class="flex gap-1">
          ${!i.budgetId ? `
            <button class="btn btn-secondary btn-sm btn-icon" onclick="showIncomeModal('${project.id}','${i.id}')">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
          ` : '<span class="badge badge-green text-xs">Auto</span>'}
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteIncome('${i.id}','${project.id}')">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="4" class="py-8 text-center text-gray-400 text-sm">Sin ingresos registrados</td></tr>`;

  return `
    <!-- Resumen financiero -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      ${[
        ['Presupuesto Aprobado', DB.getBudgetsByProject(project.id).filter(b=>['aprobado-total','aprobado-parcial'].includes(b.status)).reduce((s,b)=>s+calcBudgetTotal(b.items||[]),0), 'text-gray-900'],
        ['Total Ingresos', fin.totalIncome, 'text-green-600'],
        ['Total Gastos', fin.totalExpense, 'text-red-600'],
        ['Ganancia', fin.profit, fin.profit >= 0 ? 'text-green-600' : 'text-red-600'],
      ].map(([l,v,c]) => `
        <div class="kpi-card text-center">
          <p class="text-xs text-gray-400 mb-1">${l}</p>
          <p class="text-lg font-bold ${c}">${fmtCurrency(v, project.administration)}</p>
        </div>
      `).join('')}
    </div>

    <!-- Gastos -->
    <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-6">
      <div class="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 class="font-semibold text-gray-900">Gastos</h3>
        <button class="btn btn-primary btn-sm" onclick="showExpenseModal('${project.id}',null)">+ Gasto</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Importe</th><th>Notas</th><th style="width:70px"></th></tr></thead>
        <tbody>${expRows}</tbody>
      </table>
    </div>

    <!-- Ingresos -->
    <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div class="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 class="font-semibold text-gray-900">Ingresos</h3>
        <button class="btn btn-primary btn-sm" onclick="showIncomeModal('${project.id}',null)">+ Ingreso</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Descripción</th><th>Importe</th><th style="width:80px"></th></tr></thead>
        <tbody>${incRows}</tbody>
      </table>
    </div>
  `;
}

window.showExpenseModal = function(projectId, expenseId) {
  const project = DB.get('projects', projectId);
  const exp = expenseId ? DB.get('expenses', expenseId) : null;
  const cfg = DB.getConfig() || {};
  const cats = (cfg.categories || []);
  Swal.fire({
    title: exp ? 'Editar Gasto' : 'Nuevo Gasto',
    html: `
      <div style="text-align:left">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px" class="mb-3">
          <div>
            <label class="form-label">Fecha</label>
            <input id="ef-date" type="date" class="form-input" value="${exp?.date||today()}">
          </div>
          <div>
            <label class="form-label">Categoría</label>
            <select id="ef-cat" class="form-select">
              ${cats.map(c => `<option value="${esc(c)}" ${exp?.category===c?'selected':''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Descripción</label>
          <input id="ef-desc" class="form-input" value="${esc(exp?.description||'')}" placeholder="Descripción del gasto">
        </div>
        <div class="mb-3">
          <label class="form-label">Importe (${ADMIN[project.administration]?.code||'ARS'})</label>
          <input id="ef-amount" type="number" min="0" step="0.01" class="form-input" value="${exp?.amount||''}">
        </div>
        <div>
          <label class="form-label">Observaciones</label>
          <input id="ef-notes" class="form-input" value="${esc(exp?.notes||'')}" placeholder="Opcional">
        </div>
      </div>
    `,
    showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#f97316',
    preConfirm: () => {
      const amount = parseFloat(document.getElementById('ef-amount').value);
      const desc = document.getElementById('ef-desc').value.trim();
      if (!desc) { Swal.showValidationMessage('La descripción es obligatoria'); return false; }
      if (isNaN(amount) || amount <= 0) { Swal.showValidationMessage('Importe inválido'); return false; }
      return { projectId, date: document.getElementById('ef-date').value, category: document.getElementById('ef-cat').value, description: desc, amount, notes: document.getElementById('ef-notes').value };
    }
  }).then(r => {
    if (!r.isConfirmed) return;
    if (expenseId) { DB.update('expenses', expenseId, r.value); notify('Gasto actualizado'); }
    else { DB.add('expenses', r.value); notify('Gasto registrado'); }
    renderProjectDetail(projectId, 'operations');
  });
};

window.showIncomeModal = function(projectId, incomeId) {
  const project = DB.get('projects', projectId);
  const inc = incomeId ? DB.get('incomes', incomeId) : null;
  Swal.fire({
    title: inc ? 'Editar Ingreso' : 'Nuevo Ingreso',
    html: `
      <div style="text-align:left">
        <div class="mb-3">
          <label class="form-label">Fecha</label>
          <input id="if-date" type="date" class="form-input" value="${inc?.date||today()}">
        </div>
        <div class="mb-3">
          <label class="form-label">Descripción</label>
          <input id="if-desc" class="form-input" value="${esc(inc?.description||'')}" placeholder="Ej: Anticipo 50%">
        </div>
        <div>
          <label class="form-label">Importe (${ADMIN[project.administration]?.code||'ARS'})</label>
          <input id="if-amount" type="number" min="0" step="0.01" class="form-input" value="${inc?.amount||''}">
        </div>
      </div>
    `,
    showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#f97316',
    preConfirm: () => {
      const amount = parseFloat(document.getElementById('if-amount').value);
      const desc = document.getElementById('if-desc').value.trim();
      if (!desc) { Swal.showValidationMessage('La descripción es obligatoria'); return false; }
      if (isNaN(amount) || amount <= 0) { Swal.showValidationMessage('Importe inválido'); return false; }
      return { projectId, date: document.getElementById('if-date').value, description: desc, amount };
    }
  }).then(r => {
    if (!r.isConfirmed) return;
    if (incomeId) { DB.update('incomes', incomeId, r.value); notify('Ingreso actualizado'); }
    else { DB.add('incomes', r.value); notify('Ingreso registrado'); }
    renderProjectDetail(projectId, 'operations');
  });
};

async function deleteExpense(id, projectId) {
  if (!await confirmDelete('este gasto')) return;
  DB.remove('expenses', id); notify('Gasto eliminado', 'info');
  renderProjectDetail(projectId, 'operations');
}
async function deleteIncome(id, projectId) {
  if (!await confirmDelete('este ingreso')) return;
  DB.remove('incomes', id); notify('Ingreso eliminado', 'info');
  renderProjectDetail(projectId, 'operations');
}

// ═══════════════════════════════════════════════════════════════
// FACTURACIÓN (tab — solo USA)
// ═══════════════════════════════════════════════════════════════
function renderTabInvoices(project) {
  const invoices = DB.getInvoicesByProject(project.id).sort((a,b) => (a.number||0) - (b.number||0));
  const rows = invoices.length ? invoices.map(inv => {
    const total = calcBudgetTotal(inv.items || []);
    return `<tr>
      <td class="font-medium">#${(typeof inv.number === 'number' ? String(inv.number).padStart(3,'0') : (inv.number||inv.invoiceNumber||'(sin número)'))}</td>
      <td>${badge(inv.status, INVOICE_STATUS)}</td>
      <td class="font-semibold text-gray-900">${fmtCurrency(total, project.administration)}</td>
      <td class="text-gray-400">${fmtDate(inv.date)}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="navigate('#/projects/${project.id}/invoices/${inv.id}')">Ver / Editar</button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="exportInvoicePDF('${inv.id}')" title="PDF">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteInvoice('${inv.id}','${project.id}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="5"><div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg><p>Sin facturas</p></div></td></tr>`;

  return `
    <div class="flex justify-end mb-4">
      <button class="btn btn-primary btn-sm" onclick="navigate('#/projects/${project.id}/invoices/new')">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        Nueva Factura
      </button>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Número</th><th>Estado</th><th>Total</th><th>Fecha</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderInvoiceForm(projectId, invoiceId) {
  const project = DB.get('projects', projectId);
  if (!project) return navigate('#/projects');
  const inv = invoiceId ? DB.get('invoices', invoiceId) : null;
  const num = inv?.number ?? inv?.invoiceNumber ?? '(nueva)';
  const cfg = DB.getConfig() || {};

  setBreadcrumb([
    { label: 'Proyectos', route: '#/projects' },
    { label: project.name, route: `#/projects/${projectId}/invoices` },
    { label: `Factura #${(typeof num === 'number' ? String(num).padStart(3,'0') : String(num))}` },
  ]);
  setActions(`
    <button class="btn btn-secondary btn-sm" onclick="navigate('#/projects/${projectId}/invoices')">← Volver</button>
    ${inv ? `<button class="btn btn-secondary btn-sm" onclick="exportInvoicePDF('${invoiceId}')">📄 PDF</button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="saveInvoiceForm('${projectId}','${invoiceId||''}')">💾 Guardar</button>
  `);

  const items = inv?.items || [{ description: '', qty: 1, unit: 'unit', unitPrice: 0 }];
  const statusOpts = Object.entries(INVOICE_STATUS).map(([k,v]) =>
    `<option value="${k}" ${(inv?.status||'borrador')===k?'selected':''}>${v.label}</option>`).join('');

  setContent(`
    <div class="max-w-4xl mx-auto space-y-6" id="invoice-form-wrap">
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="form-group mb-0">
            <label class="form-label">Bill To</label>
            <input id="inv-client" class="form-input" value="${esc(project.client||'')}" placeholder="Client name">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Invoice Date</label>
            <input id="inv-date" type="date" class="form-input" value="${inv?.date||today()}">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Due Date</label>
            <input id="inv-due" type="date" class="form-input" value="${inv?.dueDate||''}">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Status</label>
            <select id="inv-status" class="form-select">${statusOpts}</select>
          </div>
        </div>
      </div>

      <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div class="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 class="font-semibold text-gray-900">Invoice Items</h3>
          <span class="badge badge-orange">🇺🇸 USD</span>
        </div>
        <div class="overflow-x-auto">
          <table class="li-table w-full" id="inv-li-table">
            <thead><tr><th style="min-width:200px">Description</th><th style="width:80px">Qty</th><th style="width:80px">Unit</th><th style="width:120px">Unit Price</th><th style="width:130px;text-align:right;padding-right:12px">Amount</th><th style="width:40px"></th></tr></thead>
            <tbody id="inv-li-tbody">${items.map((it,i) => `
              <tr id="inv-li-row-${i}">
                <td><input type="text" placeholder="Service description" value="${esc(it.description||'')}" oninput="updateInvRow(${i})"></td>
                <td><input type="number" min="0" value="${it.qty||1}" oninput="updateInvRow(${i})" id="inv-qty-${i}"></td>
                <td><input type="text" value="${esc(it.unit||'unit')}" oninput="updateInvRow(${i})"></td>
                <td><input type="number" min="0" step="0.01" value="${it.unitPrice||0}" oninput="updateInvRow(${i})" id="inv-up-${i}"></td>
                <td style="text-align:right;padding-right:12px;font-weight:600;color:#374151" id="inv-total-${i}">${fmtCurrency((it.qty||1)*(it.unitPrice||0),'USA')}</td>
                <td><button onclick="removeInvRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td>
              </tr>
            `).join('')}</tbody>
          </table>
        </div>
        <div class="p-4 border-t border-gray-100 flex items-center justify-between">
          <button onclick="addInvRow()" class="btn btn-secondary btn-sm">+ Add item</button>
          <div class="text-right">
            <p class="text-xs text-gray-400 mb-1">TOTAL</p>
            <p class="text-2xl font-bold text-gray-900" id="inv-total-grand">${fmtCurrency(calcBudgetTotal(items),'USA')}</p>
          </div>
        </div>
      </div>

      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <label class="form-label">Notes / Payment Terms</label>
        <textarea id="inv-notes" class="form-textarea" rows="2" placeholder="Payment terms, bank details...">${esc(inv?.notes||'')}</textarea>
      </div>
    </div>
  `);

  window._invItems = items.map(it => ({ ...it }));

  window.updateInvRow = (i) => {
    const rows = document.querySelectorAll('#inv-li-tbody tr');
    if (!rows[i]) return;
    const inputs = rows[i].querySelectorAll('input');
    window._invItems[i] = { description: inputs[0].value, qty: Number(inputs[1].value)||0, unit: inputs[2].value, unitPrice: Number(inputs[3].value)||0 };
    document.getElementById(`inv-total-${i}`).textContent = fmtCurrency(window._invItems[i].qty * window._invItems[i].unitPrice, 'USA');
    document.getElementById('inv-total-grand').textContent = fmtCurrency(calcBudgetTotal(window._invItems), 'USA');
  };
  window.addInvRow = () => {
    window._invItems.push({ description:'', qty:1, unit:'unit', unitPrice:0 });
    const i = window._invItems.length - 1;
    const tr = document.createElement('tr'); tr.id = `inv-li-row-${i}`;
    tr.innerHTML = `<td><input type="text" placeholder="Service description" oninput="updateInvRow(${i})"></td><td><input type="number" min="0" value="1" oninput="updateInvRow(${i})"></td><td><input type="text" value="unit" oninput="updateInvRow(${i})"></td><td><input type="number" min="0" step="0.01" value="0" oninput="updateInvRow(${i})"></td><td style="text-align:right;padding-right:12px;font-weight:600;color:#374151" id="inv-total-${i}">${fmtCurrency(0,'USA')}</td><td><button onclick="removeInvRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td>`;
    document.getElementById('inv-li-tbody').appendChild(tr);
  };
  window.removeInvRow = (i) => {
    window._invItems.splice(i, 1);
    document.getElementById('inv-li-tbody').innerHTML = window._invItems.map((it,j) => `
      <tr id="inv-li-row-${j}"><td><input type="text" value="${esc(it.description||'')}" oninput="updateInvRow(${j})"></td><td><input type="number" value="${it.qty||1}" oninput="updateInvRow(${j})"></td><td><input type="text" value="${esc(it.unit||'unit')}" oninput="updateInvRow(${j})"></td><td><input type="number" value="${it.unitPrice||0}" oninput="updateInvRow(${j})"></td><td id="inv-total-${j}" style="text-align:right;padding-right:12px;font-weight:600">${fmtCurrency((it.qty||1)*(it.unitPrice||0),'USA')}</td><td><button onclick="removeInvRow(${j})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>
    `).join('');
    document.getElementById('inv-total-grand').textContent = fmtCurrency(calcBudgetTotal(window._invItems), 'USA');
  };
}

window.saveInvoiceForm = function(projectId, invoiceId) {
  const project = DB.get('projects', projectId);
  const items = (window._invItems || []).filter(it => it.description || it.unitPrice);
  if (!items.length) { notify('Agregá al menos un ítem', 'warning'); return; }
  const data = {
    projectId,
    clientName: document.getElementById('inv-client')?.value.trim() || '',
    date: document.getElementById('inv-date')?.value || today(),
    dueDate: document.getElementById('inv-due')?.value || '',
    status: document.getElementById('inv-status')?.value || 'borrador',
    notes: document.getElementById('inv-notes')?.value || '',
    items, total: calcBudgetTotal(items),
  };
  if (invoiceId) {
    DB.update('invoices', invoiceId, data); notify('Factura actualizada');
  } else {
    // Para facturas USA, reutilizar número de presupuesto aprobado si existe
    let num;
    if (project?.administration === 'USA') {
      const activeBudget = DB.getActiveBudget(projectId);
      num = activeBudget?.number ?? activeBudget?.budgetNumber ?? null;
    }
    if (!num) num = DB.nextNumber('invoiceCounter');
    DB.add('invoices', { ...data, number: num, invoiceNumber: (typeof num === 'string' ? num : undefined) });
    notify('Factura creada');
  }
  navigate(`#/projects/${projectId}/invoices`);
};

async function deleteInvoice(id, projectId) {
  if (!await confirmDelete('esta factura')) return;
  DB.remove('invoices', id); notify('Factura eliminada', 'info');
  renderProjectDetail(projectId, 'invoices');
}

// ═══════════════════════════════════════════════════════════════
// SEGUIMIENTO DE PRESUPUESTOS
// ═══════════════════════════════════════════════════════════════
function renderTracker() {
  setBreadcrumb([{ label: 'Presupuestos' }]);
  setActions(`
    <button class="btn btn-primary btn-sm" onclick="navigate('#/presupuestos/new')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
      Nuevo Presupuesto
    </button>
  `);

  const budgets = DB.getAll('budgets').sort((a,b) => b.createdAt > a.createdAt ? 1:-1);
  const clients = [...new Set(budgets.map(b => b.clientName).filter(Boolean))].sort();

  const rows = budgets.map(b => {
    const total = calcBudgetTotal(b.items || []);
    const project = b.projectId ? DB.get('projects', b.projectId) : null;
    
    return `<tr class="b-row cursor-pointer hover:bg-gray-50" data-status="${b.status}" data-admin="${b.administration||''}" data-client="${esc(b.clientName||'')}" onclick="navigate('#/presupuestos/${b.id}')">
      <td class="font-medium text-gray-900">#${(typeof b.number === 'number' ? String(b.number).padStart(3,'0') : (b.number||b.budgetNumber||b.invoiceNumber||'(sin número)'))}</td>
      <td>
        <span class="font-semibold text-gray-900">${esc(b.projectName||'—')}</span>
        ${project ? `<span class="text-xs text-gray-400 ml-2">(Proyecto activo)</span>` : ''}
      </td>
      <td class="text-gray-600">${esc(b.clientName||'—')}</td>
      <td>${b.administration ? adminBadge(b.administration) : '—'}</td>
      <td>${badge(b.status, BUDGET_STATUS)}</td>
      <td class="font-semibold text-gray-900">${fmtCurrency(total, b.administration||'ARG')}</td>
      <td class="text-gray-400">${fmtDate(b.date)}</td>
      <td onclick="event.stopPropagation()">
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="navigate('#/presupuestos/${b.id}')">Abrir</button>
          ${!project && ['borrador', 'enviado'].includes(b.status) ? `
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteBudgetDirect('${b.id}')" title="Eliminar">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  });

  setContent(`
    <div class="max-w-6xl mx-auto">
      <!-- Filtros -->
      <div class="flex flex-wrap gap-3 mb-5 items-center">
        <input id="q-tracker" type="text" placeholder="Buscar..." class="form-input" style="max-width:220px" oninput="filterTracker()">
        <select id="tf-status" class="form-select" style="max-width:180px" onchange="filterTracker()">
          <option value="">Todos los estados</option>
          ${Object.entries(BUDGET_STATUS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
        <select id="tf-admin" class="form-select" style="max-width:200px" onchange="filterTracker()">
          <option value="">Todas las administraciones</option>
          ${Object.entries(ADMIN).map(([k,v]) => `<option value="${k}">${v.flag} ${v.label}</option>`).join('')}
        </select>
        <select id="tf-client" class="form-select" style="max-width:200px" onchange="filterTracker()">
          <option value="">Todos los clientes</option>
          ${clients.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Proyecto</th><th>Cliente</th><th>Administración</th><th>Estado</th><th>Total</th><th>Fecha</th><th></th></tr></thead>
          <tbody id="tracker-body">${rows.length ? rows.join('') : '<tr><td colspan="8"><div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><p>Sin presupuestos todavía</p><small>Hacé clic en "Nuevo Presupuesto" para crear el primero</small></div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);
}

async function deleteBudgetDirect(budgetId) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) return;
  const bnum = budget.number ?? budget.budgetNumber ?? '';
  if (!await confirmDelete(`Presupuesto #${(typeof bnum === 'number' ? String(bnum).padStart(3,'0') : String(bnum))}`)) return;
  DB.remove('budgets', budgetId);
  notify('Presupuesto eliminado', 'info');
  renderTracker();
}

function filterTracker() {
  const q = (document.getElementById('q-tracker')?.value||'').toLowerCase();
  const fst = document.getElementById('tf-status')?.value||'';
  const fadm = document.getElementById('tf-admin')?.value||'';
  const fcli = document.getElementById('tf-client')?.value||'';
  document.querySelectorAll('.b-row').forEach(r => {
    const txt = r.textContent.toLowerCase();
    const show = (!q || txt.includes(q)) &&
      (!fst || r.dataset.status === fst) &&
      (!fadm || r.dataset.admin === fadm) &&
      (!fcli || r.dataset.client === fcli);
    r.style.display = show ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════
// FACTURAS — VISTA GLOBAL (todas las facturas USA)
// ═══════════════════════════════════════════════════════════════
function renderAllInvoices() {
  setBreadcrumb([{ label: 'Facturas' }]);
  setActions('');

  const invoices = DB.getAll('invoices').sort((a,b) => b.createdAt > a.createdAt ? 1:-1);
  const projects = DB.getAll('projects');
  const pMap = Object.fromEntries(projects.map(p => [p.id, p]));

  const rows = invoices.map(inv => {
    const p = pMap[inv.projectId] || {};
    const total = calcBudgetTotal(inv.items || []);
    return `<tr>
      <td class="font-medium text-gray-900">#${(typeof inv.number === 'number' ? String(inv.number).padStart(3,'0') : (inv.number||inv.invoiceNumber||'(sin número)'))}</td>
      <td><a onclick="navigate('#/projects/${p.id}/invoices/${inv.id}')" class="font-semibold cursor-pointer" style="color: #de591f;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">${esc(p.name||'—')}</a></td>
      <td class="text-gray-600">${esc(inv.clientName || p.client||'—')}</td>
      <td>${badge(inv.status, INVOICE_STATUS)}</td>
      <td class="font-semibold text-green-700">${fmtCurrency(total,'USA')}</td>
      <td class="text-gray-400">${fmtDate(inv.date)}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="navigate('#/projects/${p.id}/invoices/${inv.id}')">Ver</button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="exportInvoicePDF('${inv.id}')" title="PDF">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </button>
        </div>
      </td>
    </tr>`;
  });

  setContent(`
    <div class="max-w-5xl mx-auto">
      <div class="flex items-center gap-3 mb-5 flex-wrap">
        <input id="q-inv" type="text" placeholder="Buscar factura..." class="form-input" style="max-width:260px" oninput="filterAllInvoices()">
        <select id="fi-status" class="form-select" style="max-width:180px" onchange="filterAllInvoices()">
          <option value="">Todos los estados</option>
          ${Object.entries(INVOICE_STATUS).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>#</th><th>Proyecto</th><th>Cliente</th><th>Estado</th><th>Total (USD)</th><th>Fecha</th><th></th></tr></thead>
          <tbody id="inv-global-body">${rows.length ? rows.join('') : '<tr><td colspan="7"><div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg><p>Sin facturas</p><small>Las facturas de proyectos de EE.UU. apareceran aqui</small></div></td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `);
}

function filterAllInvoices() {
  const q = (document.getElementById('q-inv')?.value||'').toLowerCase();
  const fst = document.getElementById('fi-status')?.value||'';
  document.querySelectorAll('#inv-global-body tr').forEach(r => {
    const show = (!q || r.textContent.toLowerCase().includes(q)) && (!fst || r.innerHTML.includes(INVOICE_STATUS[fst]?.label||''));
    r.style.display = show ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════
// ADMINISTRACIONES
// ═══════════════════════════════════════════════════════════════
function renderAdministraciones() {
  setBreadcrumb([{ label: 'Administraciones' }]);
  setActions('');

  const cards = Object.entries(ADMIN).map(([key, a]) => {
    const allProjects = DB.getAll('projects').filter(p => p.administration === key);
    const activeProjects = allProjects.filter(p => p.status === 'activo');
    const completedProjects = allProjects.filter(p => p.status === 'completado');
    const totalProjects = allProjects.length;
    
    // Calculate earnings (only incomes, not expenses)
    const operations = DB.getAll('operations').filter(o => o.administration === key);
    const earnings = operations.filter(o => o.tipo === 'ingreso')
      .reduce((sum, op) => sum + (Number(op.monto) || 0), 0);
    
    return `
      <div class="kpi-card border-2 hover:shadow-lg transition-shadow" style="border-color: ${a.flagColor}30">
        <div class="flex items-center gap-3 mb-5 pb-4 border-b-2" style="border-color: ${a.flagColor}30">
          <div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background: ${a.flagColor}; color: white; font-size: 18px; font-weight: 800;">${a.flag}</div>
          <div>
            <h3 class="font-bold text-gray-900 text-xl">${esc(a.label)}</h3>
            <p class="text-xs font-semibold" style="color: ${a.flagColor}">${a.code} · ${a.symbol}</p>
          </div>
        </div>
        
        <!-- Boxes de proyectos -->
        <div class="grid grid-cols-3 gap-3 mb-5">
          <div class="text-center p-3 rounded-xl" style="background: #F9F9F9; border: 2px solid #E7E7E7">
            <p class="text-xs font-bold text-gray-500 uppercase mb-1">Activos</p>
            <p class="text-2xl font-bold" style="color: ${a.flagColor}">${activeProjects.length}</p>
          </div>
          <div class="text-center p-3 rounded-xl" style="background: #F9F9F9; border: 2px solid #E7E7E7">
            <p class="text-xs font-bold text-gray-500 uppercase mb-1">Realizados</p>
            <p class="text-2xl font-bold" style="color: ${a.flagColor}">${completedProjects.length}</p>
          </div>
          <div class="text-center p-3 rounded-xl" style="background: ${a.flagColor}15; border: 2px solid ${a.flagColor}">
            <p class="text-xs font-bold uppercase mb-1" style="color: ${a.flagColor}">Totales</p>
            <p class="text-2xl font-bold" style="color: ${a.flagColor}">${totalProjects}</p>
          </div>
        </div>
        
        <!-- Ganancias -->
        <div class="p-4 rounded-xl text-center mb-4" style="background: ${a.flagColor}20; border: 2px solid ${a.flagColor}40">
          <p class="text-xs font-bold uppercase mb-2" style="color: ${a.flagColor}">Ganancias Totales</p>
          <p class="text-2xl font-bold" style="color: ${a.flagColor}">${fmtCurrency(earnings, key)}</p>
        </div>
        
        <button onclick="filterProjectsByAdmin('${key}')" class="btn btn-secondary btn-sm w-full">
          Ver proyectos de ${a.label}
        </button>
      </div>
    `;
  }).join('');

  setContent(`
    <div class="max-w-5xl mx-auto">
      <p class="text-sm text-gray-600 mb-6">Resumen de actividad por administración. Cada administración maneja su propia moneda y contabilidad.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">${cards}</div>
    </div>
  `);
}

window.filterProjectsByAdmin = function(adminKey) {
  navigate('#/projects');
  // Small delay to ensure the projects page is rendered before filtering
  setTimeout(() => {
    const selectEl = document.getElementById('f-admin');
    if (selectEl) {
      selectEl.value = adminKey;
      filterProjects();
    }
  }, 100);
};

// ═══════════════════════════════════════════════════════════════
// TABS PLACEHOLDER: DOCUMENTOS e HISTORIAL
// ═══════════════════════════════════════════════════════════════
function renderTabDocuments(project) {
  return `
    <div class="empty-state" style="padding:80px 20px">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
      </svg>
      <p>Documentos del proyecto</p>
      <small>Proximamente &mdash; adjunta contratos, fotos, comprobantes y otros archivos de <b>${esc(project.name)}</b></small>
    </div>
  `;
}

function renderTabHistory(project) {
  const createdDate = project.createdAt ? new Date(project.createdAt).toLocaleDateString('es-AR') : '—';
  return `
    <div class="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 class="font-semibold text-gray-900 mb-4">Historial del proyecto</h3>
      <div class="space-y-3">
        <div class="flex items-start gap-3 text-sm">
          <div class="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style="background: #de591f;"></div>
          <div>
            <p class="font-medium text-gray-900">Proyecto creado</p>
            <p class="text-gray-400 text-xs">${createdDate}</p>
          </div>
        </div>
        <div class="flex items-start gap-3 text-sm">
          <div class="w-2 h-2 rounded-full bg-gray-200 mt-1.5 flex-shrink-0"></div>
          <div>
            <p class="text-gray-400">Estado actual: <b class="text-gray-700">${PROJECT_STATUS[project.status]?.label||project.status}</b></p>
          </div>
        </div>
      </div>
      <p class="text-xs text-gray-300 mt-6">El historial completo de cambios estara disponible proximamente.</p>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
function renderSettings(section = 'company') {
  setBreadcrumb([{ label: 'Configuración' }]);
  setActions('');

  const sections = [
    { key: 'company',    label: 'Empresa' },
    { key: 'clients',    label: 'Clientes' },
    { key: 'categories', label: 'Categorias de Gastos' },
    { key: 'demo',       label: '📦 Datos de Ejemplo' },
  ];

  const tabs = `<div class="flex flex-wrap gap-2 mb-6">
    ${sections.map(s => `
      <button class="btn ${section===s.key ? 'btn-primary' : 'btn-secondary'}" onclick="renderSettings('${s.key}')">${s.label}</button>
    `).join('')}
  </div>`;

  let body = '';
  if (section === 'company') body = renderCompanySettings();
  if (section === 'clients') body = renderClientSettings();
  if (section === 'categories') body = renderCategorySettings();
  if (section === 'demo') body = renderDemoDataSettings();

  setContent(`<div class="max-w-3xl mx-auto">${tabs}${body}</div>`);
}

function renderCompanySettings() {
  const cfg = DB.getConfig() || {};
  const c = cfg.company || {};
  return `
    <div class="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 class="font-semibold text-gray-900 mb-5">Datos de la Empresa</h3>
      
      <!-- Logo Upload -->
      <div class="form-group mb-6 pb-6 border-b border-gray-200">
        <label class="form-label">Logo de la Empresa</label>
        <div class="flex items-center gap-4">
          ${c.logo ? `<img src="${c.logo}" class="w-24 h-24 object-contain border border-gray-200 rounded-lg" id="logo-preview">` : '<div id="logo-preview" class="w-24 h-24 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-gray-400 text-xs">Sin logo</div>'}
          <div class="flex-1">
            <input type="file" id="company-logo-upload" accept="image/*" class="form-input" onchange="handleCompanyLogoUpload(event)">
            <p class="text-xs text-gray-500 mt-2">El logo se mostrará en todos los presupuestos y facturas en PDF. Formato recomendado: PNG o JPG.</p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${[
          ['company-name','Nombre de la empresa','text',c.name||''],
          ['company-tagline','Tagline / Descripción','text',c.tagline||''],
          ['company-email','Email','email',c.email||''],
          ['company-phone','Teléfono','tel',c.phone||''],
          ['company-address','Dirección','text',c.address||''],
          ['company-taxid','CUIT / Tax ID','text',c.taxId||''],
        ].map(([id,label,type,val]) => `
          <div class="form-group">
            <label class="form-label">${label}</label>
            <input id="${id}" type="${type}" class="form-input" value="${esc(val)}">
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary mt-4" onclick="saveCompanySettings()">Guardar cambios</button>
    </div>
  `;
}

window.handleCompanyLogoUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const logo = e.target.result;
    const cfg = DB.getConfig() || {};
    cfg.company = cfg.company || {};
    cfg.company.logo = logo;
    DB.setConfig(cfg);
    const preview = document.getElementById('logo-preview');
    if (preview) {
      preview.outerHTML = `<img src="${logo}" class="w-24 h-24 object-contain border border-gray-200 rounded-lg" id="logo-preview">`;
    }
    notify('Logo guardado correctamente');
  };
  reader.readAsDataURL(file);
};

window.saveCompanySettings = function() {
  const cfg = DB.getConfig() || {};
  cfg.company = cfg.company || {};
  cfg.company = {
    ...cfg.company,
    name: document.getElementById('company-name')?.value.trim() || 'Aurea',
    tagline: document.getElementById('company-tagline')?.value.trim() || '',
    email: document.getElementById('company-email')?.value.trim() || '',
    phone: document.getElementById('company-phone')?.value.trim() || '',
    address: document.getElementById('company-address')?.value.trim() || '',
    taxId: document.getElementById('company-taxid')?.value.trim() || '',
  };
  DB.setConfig(cfg);
  notify('Configuración guardada');
};

function renderClientSettings() {
  const clients = DB.getAll('clients');
  const rows = clients.length ? clients.map(c => `
    <tr>
      <td class="font-medium text-gray-900">${esc(c.name)}</td>
      <td class="text-gray-500">${esc(c.email||'—')}</td>
      <td class="text-gray-500">${esc(c.phone||'—')}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm btn-icon" onclick="showClientModal('${c.id}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
          </button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteClient('${c.id}','${esc(c.name)}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('') : `<tr><td colspan="4" class="py-8 text-center text-gray-400">Sin clientes</td></tr>`;

  return `
    <div class="table-wrap">
      <div class="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 class="font-semibold text-gray-900">Clientes</h3>
        <button class="btn btn-primary btn-sm" onclick="showClientModal(null)">+ Nuevo cliente</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Email</th><th>Teléfono</th><th style="width:80px"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

window.showClientModal = function(id) {
  const c = id ? DB.get('clients', id) : null;
  Swal.fire({
    title: c ? 'Editar Cliente' : 'Nuevo Cliente',
    html: `
      <div style="text-align:left">
        <div class="form-group"><label class="form-label">Nombre *</label><input id="cl-name" class="form-input" value="${esc(c?.name||'')}"></div>
        <div class="form-group"><label class="form-label">Email</label><input id="cl-email" type="email" class="form-input" value="${esc(c?.email||'')}"></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input id="cl-phone" class="form-input" value="${esc(c?.phone||'')}"></div>
        <div><label class="form-label">Dirección</label><input id="cl-address" class="form-input" value="${esc(c?.address||'')}"></div>
      </div>
    `,
    showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#f97316',
    preConfirm: () => {
      const name = document.getElementById('cl-name').value.trim();
      if (!name) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
      return { name, email: document.getElementById('cl-email').value, phone: document.getElementById('cl-phone').value, address: document.getElementById('cl-address').value };
    }
  }).then(r => {
    if (!r.isConfirmed) return;
    if (id) { DB.update('clients', id, r.value); notify('Cliente actualizado'); }
    else { DB.add('clients', r.value); notify('Cliente creado'); }
    renderSettings('clients');
  });
};

async function deleteClient(id, name) {
  if (!await confirmDelete(name)) return;
  DB.remove('clients', id); notify('Cliente eliminado', 'info');
  renderSettings('clients');
}

function renderCategorySettings() {
  const cfg = DB.getConfig() || {};
  const cats = cfg.categories || [];
  return `
    <div class="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 class="font-semibold text-gray-900 mb-4">Categorías de Gastos</h3>
      <div id="cats-list" class="space-y-2 mb-4">
        ${cats.map((c,i) => `
          <div class="flex items-center gap-2">
            <input class="form-input flex-1" id="cat-${i}" value="${esc(c)}">
            <button class="btn btn-danger btn-sm btn-icon" onclick="removeCat(${i})">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
      <div class="flex gap-3">
        <button class="btn btn-secondary btn-sm" onclick="addCat()">+ Agregar categoría</button>
        <button class="btn btn-primary btn-sm" onclick="saveCats()">Guardar</button>
      </div>
    </div>
  `;
}

window.addCat = function() {
  const cfg = DB.getConfig() || {};
  const cats = [...(cfg.categories || []), ''];
  cfg.categories = cats;
  DB.setConfig(cfg);
  renderSettings('categories');
};

window.removeCat = function(i) {
  const cfg = DB.getConfig() || {};
  cfg.categories.splice(i, 1);
  DB.setConfig(cfg);
  renderSettings('categories');
};

window.saveCats = function() {
  const cfg = DB.getConfig() || {};
  const inputs = document.querySelectorAll('[id^="cat-"]');
  cfg.categories = Array.from(inputs).map(i => i.value.trim()).filter(Boolean);
  DB.setConfig(cfg);
  notify('Categorías guardadas');
  renderSettings('categories');
};

function renderDemoDataSettings() {
  const isDemoMode = window.isDemoMode;
  const allBudgets = DB.getAll('budgets');
  const allProjects = DB.getAll('projects');
  const allInvoices = DB.getAll('invoices');
  
  const hasData = allBudgets.length > 0 || allProjects.length > 0 || allInvoices.length > 0;
  
  return `
    <div class="bg-white border border-gray-200 rounded-2xl p-6">
      <div class="flex items-start gap-4 mb-6">
        <div class="w-12 h-12 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
          <svg class="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="font-semibold text-gray-900 mb-2">Cargar Datos de Ejemplo</h3>
          <p class="text-sm text-gray-600 mb-4">
            Carga datos de muestra para probar todas las funcionalidades de la aplicación. 
            Esto creará presupuestos, proyectos, facturas, ingresos y gastos de ejemplo.
          </p>
          
          ${isDemoMode ? `
            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <div class="flex items-center gap-2 text-blue-700 text-sm font-medium mb-1">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
                </svg>
                Modo Demo Activo
              </div>
              <p class="text-xs text-blue-600">Los datos se guardarán en localStorage (tu navegador)</p>
            </div>
          ` : `
            <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
              <div class="flex items-center gap-2 text-green-700 text-sm font-medium mb-1">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                Modo Producción (Firebase)
              </div>
              <p class="text-xs text-green-600">Los datos se guardarán en Firestore</p>
            </div>
          `}
          
          ${hasData ? `
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <div class="flex items-start gap-2">
                <svg class="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
                <div class="flex-1">
                  <p class="text-sm font-medium text-yellow-800">Ya tienes datos existentes</p>
                  <p class="text-xs text-yellow-700 mt-1">
                    Tienes ${allBudgets.length} presupuesto(s), ${allProjects.length} proyecto(s), ${allInvoices.length} factura(s).
                    Cargar datos de ejemplo agregará más registros.
                  </p>
                </div>
              </div>
            </div>
          ` : ''}
          
          <div class="bg-gray-50 rounded-lg p-4 mb-4">
            <h4 class="text-sm font-semibold text-gray-900 mb-3">📊 Qué se creará:</h4>
            <ul class="space-y-2 text-sm text-gray-700">
              <li class="flex items-start gap-2">
                <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span><strong>3 Presupuestos</strong> en ARG, PERU y USA con diferentes estados</span>
              </li>
              <li class="flex items-start gap-2">
                <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span><strong>1 Proyecto activo</strong> con todas sus etapas</span>
              </li>
              <li class="flex items-start gap-2">
                <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span><strong>2 Ingresos</strong> registrados (pagos del cliente)</span>
              </li>
              <li class="flex items-start gap-2">
                <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span><strong>3 Gastos del proyecto</strong> (software, consultoría, viáticos)</span>
              </li>
              <li class="flex items-start gap-2">
                <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span><strong>3 Operaciones/tareas</strong> del proyecto</span>
              </li>
              <li class="flex items-start gap-2">
                <svg class="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                <span><strong>1 Factura</strong> emitida y pagada</span>
              </li>
            </ul>
          </div>
          
          <button 
            id="load-demo-btn"
            class="btn btn-primary w-full"
            onclick="loadDemoDataWithConfirm()"
          >
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            Cargar Datos de Ejemplo
          </button>
          
          <p class="text-xs text-gray-500 text-center mt-3">
            💡 Ver <a href="#" class="text-brand-500 hover:underline" onclick="event.preventDefault(); window.open('DATOS-EJEMPLO.md')">DATOS-EJEMPLO.md</a> para más detalles
          </p>
        </div>
      </div>
    </div>
  `;
}

window.loadDemoDataWithConfirm = async function() {
  const btn = document.getElementById('load-demo-btn');
  if (!btn) return;
  
  // Confirmar antes de cargar
  if (!confirm('¿Seguro que quieres cargar los datos de ejemplo?\n\nEsto creará múltiples presupuestos, proyectos, facturas e ingresos/gastos de muestra.')) {
    return;
  }
  
  // Deshabilitar botón y mostrar loading
  btn.disabled = true;
  btn.innerHTML = `
    <svg class="animate-spin w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    Cargando...
  `;
  
  try {
    // Llamar a la función que ya existe en datos-ejemplo.js
    if (typeof window.cargarDatosEjemplo === 'function') {
      await window.cargarDatosEjemplo();
    } else {
      throw new Error('La función cargarDatosEjemplo no está disponible. Asegúrate de que datos-ejemplo.js está cargado.');
    }
  } catch (error) {
    console.error('Error cargando datos:', error);
    notify('Error al cargar datos de ejemplo: ' + error.message, 'error');
    
    // Restaurar botón
    btn.disabled = false;
    btn.innerHTML = `
      <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
      </svg>
      Cargar Datos de Ejemplo
    `;
  }
};

// ═══════════════════════════════════════════════════════════════
// PDF — PRESUPUESTO
// ═══════════════════════════════════════════════════════════════
window.exportBudgetPDF = function(budgetId) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) { notify('Presupuesto no encontrado', 'error'); return; }
  
  // Try to get project if it exists
  const project = budget.projectId ? DB.get('projects', budget.projectId) : null;
  
  // Use budget data directly, or fall back to project if exists
  const clientName = budget.clientName || project?.client || '—';
  const projectName = budget.projectName || project?.name || '—';
  const administration = budget.administration || project?.administration || 'ARG';
  
  const cfg = DB.getConfig() || {};
  const comp = cfg.company || {};
  const adm = ADMIN[administration] || ADMIN.ARG;
  const total = calcBudgetTotal(budget.items || []);
  const approvedTotal = calcApprovedTotal(budget.items || []);
  const isPartialApproval = budget.status === 'aprobado-parcial';
  const showApprovalCol = budget.status !== 'borrador';

  // Translations based on administration
  const isEnglish = administration === 'USA';
  const t = {
    title: isEnglish ? 'QUOTE' : 'PRESUPUESTO',
    client: isEnglish ? 'Client' : 'Cliente',
    project: isEnglish ? 'Project' : 'Proyecto',
    date: isEnglish ? 'Date' : 'Fecha',
    description: isEnglish ? 'Description' : 'Descripción',
    qty: isEnglish ? 'Qty' : 'Cant.',
    unit: isEnglish ? 'Unit' : 'Unidad',
    unitPrice: isEnglish ? 'Unit Price' : 'P. Unitario',
    total: isEnglish ? 'Total' : 'Total',
    totalBudget: isEnglish ? 'QUOTE TOTAL' : 'TOTAL PRESUPUESTO',
    approvedTotal: isEnglish ? 'APPROVED TOTAL' : 'TOTAL APROBADO',
    termsConditions: isEnglish ? 'TERMS & CONDITIONS' : 'CONDICIONES Y OBSERVACIONES',
    generatedOn: isEnglish ? 'Document generated on' : 'Documento generado el',
  };

  const html = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:750px;margin:0 auto;padding:40px;color:#1e293b">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${adm.flagColor};padding-bottom:20px;margin-bottom:30px">
        <div style="flex:1">
          ${comp.logo ? `<img src="${comp.logo}" style="max-width:150px;max-height:80px;margin-bottom:12px;object-fit:contain" />` : ''}
          <h1 style="font-size:28px;font-weight:800;color:${adm.flagColor};margin:0">${esc(comp.name||'Aurea Technical Art')}</h1>
          ${comp.address ? `<p style="color:#64748b;font-size:12px;margin-top:6px">${esc(comp.address)}</p>` : ''}
          ${comp.city ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.city)}</p>` : ''}
          ${comp.email ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.email)}</p>` : ''}
          ${comp.phone ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.phone)}</p>` : ''}
        </div>
        <div style="text-align:right">
          <h2 style="font-size:20px;font-weight:700;color:#334155;margin:0">${t.title}</h2>
          <p style="font-size:24px;font-weight:800;color:${adm.flagColor};margin:4px 0">${budget.number}</p>
          <p style="color:#64748b;font-size:13px">${t.date}: ${fmtDate(budget.date)}</p>
          <div style="margin-top:8px">
            <span style="background:${BUDGET_STATUS[budget.status].badge.includes('green')?'#dcfce7':BUDGET_STATUS[budget.status].badge.includes('yellow')?'#fef3c7':BUDGET_STATUS[budget.status].badge.includes('blue')?'#dbeafe':'#f1f5f9'};color:${BUDGET_STATUS[budget.status].badge.includes('green')?'#16a34a':BUDGET_STATUS[budget.status].badge.includes('yellow')?'#ca8a04':BUDGET_STATUS[budget.status].badge.includes('blue')?'#2563eb':'#64748b'};padding:4px 14px;border-radius:20px;font-size:12px;font-weight:600">${BUDGET_STATUS[budget.status]?.label||budget.status}</span>
          </div>
        </div>
      </div>

      <!-- Client + Project -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:30px">
        <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:18px">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:0 0 8px">${t.client}</p>
          <p style="font-size:18px;font-weight:700;margin:0;color:#1e293b">${esc(clientName)}</p>
        </div>
        <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:18px">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:0 0 8px">${t.project}</p>
          <p style="font-size:18px;font-weight:700;margin:0;color:#1e293b">${esc(projectName)}</p>
          <p style="font-size:12px;color:#64748b;margin:6px 0 0;font-weight:600">
            <span style="display:inline-block;background:${adm.flagColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;margin-right:6px">${adm.flag}</span>
            ${adm.label} · ${adm.code}
          </p>
        </div>
      </div>

      <!-- Items table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #E7E7E7;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#F9F9F9">
            ${showApprovalCol ? '<th style="text-align:center;padding:12px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:50px">✓</th>' : ''}
            <th style="text-align:left;padding:12px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7">${t.description}</th>
            <th style="text-align:center;padding:12px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:60px">${t.qty}</th>
            <th style="text-align:center;padding:12px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:70px">${t.unit}</th>
            <th style="text-align:right;padding:12px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:120px">${t.unitPrice}</th>
            <th style="text-align:right;padding:12px 16px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:130px">${t.total}</th>
          </tr>
        </thead>
        <tbody>
          ${(budget.items||[]).map((it,i) => `
            <tr style="background:${i%2?'#F9F9F9':'#fff'}">
              ${showApprovalCol ? `<td style="text-align:center;padding:10px 8px;font-size:14px;border-bottom:1px solid #E7E7E7">${it.aprobado ? '✓' : ''}</td>` : ''}
              <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #E7E7E7;color:#334155">${esc(it.description||'')}</td>
              <td style="text-align:center;padding:12px 10px;font-size:13px;border-bottom:1px solid #E7E7E7;color:#334155;font-weight:600">${it.qty||0}</td>
              <td style="text-align:center;padding:12px 10px;font-size:13px;color:#64748b;border-bottom:1px solid #E7E7E7">${esc(it.unit||'')}</td>
              <td style="text-align:right;padding:12px 16px;font-size:13px;border-bottom:1px solid #E7E7E7;color:#334155">${fmtCurrency(it.unitPrice||0, administration)}</td>
              <td style="text-align:right;padding:12px 16px;font-size:14px;font-weight:700;border-bottom:1px solid #E7E7E7;color:#1e293b">${fmtCurrency((it.qty||0)*(it.unitPrice||0), administration)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- Total -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div style="min-width:280px">
          ${isPartialApproval ? `
            <div style="background:#FEF3C7;border:2px solid #FDE68A;border-radius:10px;padding:14px 20px;text-align:right;margin-bottom:10px">
              <p style="color:#92400E;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px;font-weight:700">${t.approvedTotal}</p>
              <p style="color:#92400E;font-size:20px;font-weight:800;margin:0">${fmtCurrency(approvedTotal, administration)}</p>
            </div>
          ` : ''}
          <div style="background:${adm.flagColor};border-radius:12px;padding:18px 24px;text-align:right">
            <p style="color:rgba(255,255,255,.8);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;font-weight:700">${t.totalBudget}</p>
            <p style="color:#fff;font-size:28px;font-weight:800;margin:0">${fmtCurrency(total, administration)}</p>
          </div>
        </div>
      </div>

      <!-- Notes -->
      ${budget.notes ? `
        <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:18px;margin-bottom:24px">
          <p style="font-size:11px;text-transform:uppercase;font-weight:700;color:#64748b;margin:0 0 10px;letter-spacing:.06em">${t.termsConditions}</p>
          <p style="font-size:13px;color:#475569;white-space:pre-wrap;margin:0;line-height:1.6">${esc(budget.notes)}</p>
        </div>
      ` : ''}

      <div style="text-align:center;font-size:11px;color:#cbd5e1;margin-top:40px;border-top:1px solid #E7E7E7;padding-top:20px">
        <p style="margin:0">${esc(comp.name||'Aurea Technical Art')} ${comp.taxId ? `· ${esc(comp.taxId)}` : ''}</p>
        <p style="margin:4px 0 0">${t.generatedOn} ${fmtDate(today())}</p>
      </div>
    </div>
  `;

  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  
  const docType = isEnglish ? 'Quote' : 'Presupuesto';
  const fileName = `${docType}_${budget.number}_${esc(clientName).replace(/\s+/g,'_')}.pdf`;
  
  html2pdf().set({
    margin: 10, 
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }).from(el).save().then(() => { document.body.removeChild(el); notify('PDF generado correctamente'); });
};

// ═══════════════════════════════════════════════════════════════
// PDF — FACTURA / INVOICE
// ═══════════════════════════════════════════════════════════════
window.exportInvoicePDF = function(invoiceId) {
  const inv = DB.get('invoices', invoiceId);
  if (!inv) { notify('Factura no encontrada', 'error'); return; }
  const project = DB.get('projects', inv.projectId);
  const cfg = DB.getConfig() || {};
  const comp = cfg.company || {};
  const total = calcBudgetTotal(inv.items || []);

  const adm = ADMIN[project?.administration || 'USA'] || ADMIN.USA;
  
  // Translations based on administration
  const isEnglish = project?.administration === 'USA';
  const t = {
    title: isEnglish ? 'INVOICE' : 'FACTURA',
    date: isEnglish ? 'Date' : 'Fecha',
    due: isEnglish ? 'Due' : 'Vencimiento',
    billTo: isEnglish ? 'Bill To' : 'Facturar a',
    project: isEnglish ? 'Project' : 'Proyecto',
    description: isEnglish ? 'Description' : 'Descripción',
    qty: isEnglish ? 'Qty' : 'Cant.',
    unit: isEnglish ? 'Unit' : 'Unidad',
    unitPrice: isEnglish ? 'Unit Price' : 'P. Unitario',
    amount: isEnglish ? 'Amount' : 'Importe',
    totalDue: isEnglish ? 'TOTAL DUE' : 'TOTAL A PAGAR',
    notes: isEnglish ? 'Notes / Payment Terms' : 'Notas / Condiciones de Pago',
    generated: isEnglish ? 'Generated' : 'Generado el',
  };
  
  const html = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:720px;margin:0 auto;padding:40px;color:#1e293b">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${adm.flagColor};padding-bottom:20px;margin-bottom:30px">
        <div style="flex:1">
          ${comp.logo ? `<img src="${comp.logo}" style="max-width:150px;max-height:80px;margin-bottom:12px;object-fit:contain" />` : ''}
          <h1 style="font-size:28px;font-weight:800;color:${adm.flagColor};margin:0">${esc(comp.name||'Aurea Technical Art')}</h1>
          ${comp.address ? `<p style="color:#64748b;font-size:12px;margin-top:6px">${esc(comp.address)}</p>` : ''}
          ${comp.city ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.city)}</p>` : ''}
          ${comp.email ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.email)}</p>` : ''}
          ${comp.phone ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.phone)}</p>` : ''}
          ${comp.taxId ? `<p style="color:#64748b;font-size:12px;margin:2px 0">Tax ID: ${esc(comp.taxId)}</p>` : ''}
        </div>
        <div style="text-align:right">
          <h2 style="font-size:20px;font-weight:700;color:#334155;margin:0">${t.title}</h2>
          <p style="font-size:24px;font-weight:800;color:${adm.flagColor};margin:4px 0">#${(typeof inv.number === 'number' ? String(inv.number).padStart(3,'0') : (inv.number||inv.invoiceNumber||'(sin número)'))}</p>
          <p style="color:#64748b;font-size:13px">${t.date}: ${fmtDate(inv.date)}</p>
          ${inv.dueDate ? `<p style="color:#64748b;font-size:13px">${t.due}: ${fmtDate(inv.dueDate)}</p>` : ''}
          <p style="font-size:12px;color:#64748b;margin:6px 0 0;font-weight:600">
            <span style="display:inline-block;background:${adm.flagColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;margin-right:6px">${adm.flag}</span>
            ${adm.label} · ${adm.code}
          </p>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:30px">
        <div style="background:#f8fafc;border-radius:10px;padding:16px">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:700;margin:0 0 6px">${t.billTo}</p>
          <p style="font-size:16px;font-weight:600;margin:0">${esc(inv.clientName||project?.client||'—')}</p>
        </div>
        <div style="background:#f8fafc;border-radius:10px;padding:16px">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;font-weight:700;margin:0 0 6px">${t.project}</p>
          <p style="font-size:16px;font-weight:600;margin:0">${esc(project?.name||'—')}</p>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead>
          <tr style="background:#f0fdf4">
            <th style="text-align:left;padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${adm.flagColor};border-bottom:2px solid #bbf7d0">${t.description}</th>
            <th style="text-align:center;width:60px;padding:10px;font-size:11px;text-transform:uppercase;color:${adm.flagColor};border-bottom:2px solid #bbf7d0">${t.qty}</th>
            <th style="text-align:center;width:60px;padding:10px;font-size:11px;text-transform:uppercase;color:${adm.flagColor};border-bottom:2px solid #bbf7d0">${t.unit}</th>
            <th style="text-align:right;width:120px;padding:10px 14px;font-size:11px;text-transform:uppercase;color:${adm.flagColor};border-bottom:2px solid #bbf7d0">${t.unitPrice}</th>
            <th style="text-align:right;width:130px;padding:10px 14px;font-size:11px;text-transform:uppercase;color:${adm.flagColor};border-bottom:2px solid #bbf7d0">${t.amount}</th>
          </tr>
        </thead>
        <tbody>
          ${(inv.items||[]).map((it,i) => `
            <tr style="background:${i%2?'#f8fafc':'#fff'}">
              <td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${esc(it.description||'')}</td>
              <td style="text-align:center;padding:10px;font-size:13px;border-bottom:1px solid #f1f5f9">${it.qty||0}</td>
              <td style="text-align:center;padding:10px;font-size:13px;color:#64748b;border-bottom:1px solid #f1f5f9">${esc(it.unit||'')}</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${fmtCurrency(it.unitPrice||0,project?.administration||'USA')}</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;font-weight:600;border-bottom:1px solid #f1f5f9">${fmtCurrency((it.qty||0)*(it.unitPrice||0),project?.administration||'USA')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div style="background:${adm.flagColor};border-radius:12px;padding:16px 24px;text-align:right;min-width:200px">
          <p style="color:rgba(255,255,255,.7);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px">${t.totalDue}</p>
          <p style="color:#fff;font-size:26px;font-weight:800;margin:0">${fmtCurrency(total,project?.administration||'USA')}</p>
        </div>
      </div>

      ${inv.notes ? `<div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:24px"><p style="font-size:11px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin:0 0 6px">${t.notes}</p><p style="font-size:13px;color:#374151;white-space:pre-wrap;margin:0">${esc(inv.notes)}</p></div>` : ''}

      <p style="text-align:center;font-size:11px;color:#cbd5e1;margin-top:30px;border-top:1px solid #f1f5f9;padding-top:16px">
        ${esc(comp.name||'Aurea')} · ${t.generated} ${fmtDate(today())}
      </p>
    </div>
  `;

  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  
  const docType = isEnglish ? 'Invoice' : 'Factura';
  const fileName = `${docType}_${(typeof inv.number === 'number' ? String(inv.number).padStart(3,'0') : (inv.number||inv.invoiceNumber||'sin-numero'))}.pdf`;
  
  html2pdf().set({
    margin: 10, 
    filename: fileName,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
  }).from(el).save().then(() => { document.body.removeChild(el); notify('PDF generado correctamente'); });
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
  DB.init();
  // Expose navigate globally for onclick handlers
  window.navigate = navigate;
  // Start router
  route(window.location.hash);
}

document.addEventListener('DOMContentLoaded', init);
