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
 *
 * [SECCIÓN: COLORES POR ADMINISTRACIÓN] — para cambiar el color identificatorio
 * de ARG/PERU/USA (el que se ve en el badge del PDF y en la dona de Administraciones),
 * editar el "flagColor" de cada una acá abajo.
 */
const ADMIN = {
  ARG:  { label: 'Argentina',       flag: 'AR', code: 'ARS', locale: 'es-AR', symbol: '$',   flagColor: '#0055A4', invoice: false },
  PERU: { label: 'Perú',            flag: 'PE', code: 'PEN', locale: 'es-PE', symbol: 'S/',  flagColor: '#DC0000', invoice: false },
  USA:  { label: 'United States',   flag: 'US', code: 'USD', locale: 'en-US', symbol: 'U$D', flagColor: '#01655C', invoice: true  },
};

window.saveSessionSettings = function() {
  try {
    const enabled = !!document.getElementById('session-enable-watch')?.checked;
    const minutes = Number(document.getElementById('session-timeout-min')?.value) || 30;
    const countdown = Number(document.getElementById('session-countdown-s')?.value) || 8;

    localStorage.setItem('aurea_enable_inactivity_watch', enabled ? 'true' : 'false');
    localStorage.setItem('aurea_inactivity_timeout_ms', String(Math.max(1, minutes) * 60 * 1000));
    localStorage.setItem('aurea_expire_countdown_s', String(Math.max(3, countdown)));

    notify('Ajustes de sesión guardados', 'success');

    // Apply immediately via Auth API if available
    try {
      if (enabled && typeof Auth.enableInactivityWatcher === 'function') {
        Auth.enableInactivityWatcher();
      } else if (!enabled && typeof Auth.disableInactivityWatcher === 'function') {
        Auth.disableInactivityWatcher();
      }
    } catch (e) { console.warn('No se pudo aplicar watcher inmediatamente:', e); }
  } catch (e) {
    console.error('Error guardando ajustes de sesión:', e);
    notify('No se pudieron guardar los ajustes', 'error');
  }
};

/**
 * PROJECT_STATUS - Estados posibles de un proyecto
 */
const PROJECT_STATUS = {
  pendiente: { label: 'Pendiente', badge: 'badge-yellow' },
  aprobado:  { label: 'Aprobado',  badge: 'badge-green'  },
  finalizado:{ label: 'Finalizado', badge: 'badge-blue'   },
  cobrado:   { label: 'Cobrado',    badge: 'badge-purple' },
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
  borrador:           { label: 'Presupuestado',      badge: 'badge-gray'   },
  enviado:            { label: 'Enviado',            badge: 'badge-blue'   },
  'aprobado-total':   { label: 'Aprobado (total)',    badge: 'badge-green'  },
  'aprobado-parcial': { label: 'Aprobado (parcial)',  badge: 'badge-green'  },
  rechazado:          { label: 'Rechazado',           badge: 'badge-gray'   },
  cancelado:          { label: 'Cancelado',           badge: 'badge-gray'   },
};

const INVOICE_STATUS = {
  borrador:  { label: 'Borrador',  badge: 'badge-gray'  },
  pendiente: { label: 'Pendiente', badge: 'badge-yellow' },
  enviado:   { label: 'Enviado',   badge: 'badge-blue'  },
  cobrado:   { label: 'Cobrado',   badge: 'badge-green' }
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
  const n = Math.round(Number(amount) || 0); // no decimals
  // Resolve admin config by key or by currency code
  let a = ADMIN[adm] || Object.values(ADMIN).find(x => x.code === adm) || ADMIN.ARG;
  // For Spanish administrations (ARG, PERU) force thousands separator as dot
  if (String(a.locale || '').startsWith('es')) {
    const int = String(Math.abs(n));
    const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const sign = n < 0 ? '-' : '';
    const out = a.code === 'PEN' ? `S./ ${sign}${withDots}` : `$ ${sign}${withDots}`;
    return out;
  }
  // Default: use locale formatting (USD)
  const formatted = n.toLocaleString(a.locale || 'en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const out = a.code === 'USD' ? `USD ${formatted}` : `${a.symbol || '$'} ${formatted}`;
  return out;
}

function fmtDate(str) {
  if (!str) return '—';
  try {
    const [y,m,d] = str.split('-');
    return `${d}/${m}/${y}`;
  } catch { return str; }
}

// parseToMs - global helper to convert many date representations to epoch ms
function parseToMs(v) {
  if (!v) return 0;
  if (typeof v === 'object' && v !== null && typeof v.seconds === 'number') {
    return (v.seconds * 1000) + (v.nanoseconds ? Math.round(v.nanoseconds / 1e6) : 0);
  }
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Date.parse(v);
    if (!isNaN(n)) return n;
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const day = Number(m[1]);
      const month = Number(m[2]) - 1;
      const year = Number(m[3]);
      return new Date(year, month, day).getTime();
    }
    return 0;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    try { return v.toDate().getTime(); } catch (e) { return 0; }
  }
  return 0;
}

let _reportingYear = new Date().getFullYear();

function recordYear(record) {
  const raw = record && (record.date || record.createdAt || record.created || record.created_at || record.startDate || record.start_date);
  // "YYYY-MM-DD" se lee directo: Date.parse lo toma como UTC y en Argentina/Perú (UTC-3/-5)
  // el 1° de enero caía en el año anterior. Mismo criterio que _recordYear en db-firebase.js.
  const isoYear = typeof raw === 'string' && raw.match(/^(\d{4})-/);
  if (isoYear) return Number(isoYear[1]);
  const timestamp = parseToMs(raw);
  return timestamp ? new Date(timestamp).getFullYear() : 0;
}

// Línea "≈ USD" de una administración (ARG/PERU). Los proyectos sin tipo de cambio quedan
// fuera de este monto y de los gráficos, así que se listan por nombre (con link y su
// ganancia) para que se puedan identificar y completar.
function usdEquivalentNote(adm, usd) {
  if (adm === 'USA') return '';
  const base = usd ? '≈ ' + fmtCurrency(usd, 'USA') : 'Cargá el dólar para ver el equivalente';
  const missing = (DB.getAll('projects') || [])
    .filter(p => p.administration === adm && recordYear(p) === _reportingYear)
    .map(p => ({ p, fin: DB.getProjectFinancials(p.id) }))
    // Con ganancia 0 el dólar no cambia ningún total: no se listan (evita avisos sin sentido).
    .filter(({ fin }) => !fin.exchangeRateToUSD && fin.profit);
  if (!missing.length) return base;
  const items = missing.map(({ p, fin }) =>
    `<li><a class="underline cursor-pointer" onclick="navigate('#/projects/${p.id}')">${esc(p.name)}</a> · ganancia ${fmtCurrency(fin.profit, adm)}</li>`).join('');
  return `${base}
    <span class="block mt-2 text-amber-700">Proyectos sin dólar cargado (no suman en USD):</span>
    <ul class="text-amber-700 list-disc pl-4">${items}</ul>`;
}

function getReportingYears() {
  const years = new Set([new Date().getFullYear()]);
  ['projects', 'budgets', 'invoices'].forEach(collection => {
    (DB.getAll(collection) || []).forEach(record => {
      const year = recordYear(record);
      if (year) years.add(year);
    });
  });
  return [...years].sort((a, b) => b - a);
}

function reportingYearSelect() {
  return `<select class="form-select" style="width:100%;background:#fff" aria-label="Año de consulta" onchange="setReportingYear(this.value)">
    ${getReportingYears().map(year => `<option value="${year}" ${year === _reportingYear ? 'selected' : ''}>${year}</option>`).join('')}
  </select>`;
}

function renderReportingYearMenu() {
  const container = document.getElementById('reporting-year-menu');
  if (container) container.innerHTML = reportingYearSelect();
}

window.setReportingYear = function(year) {
  _reportingYear = Number(year) || new Date().getFullYear();
  route(window.location.hash || '#/');
};

function canGenerateInvoicesForProject(projectOrAdministration) {
  const admin = typeof projectOrAdministration === 'string'
    ? projectOrAdministration
    : (projectOrAdministration && projectOrAdministration.administration) || '';
  return admin === 'USA';
}

// Formatea referencias de presupuesto: convierte "yymmddNNN" → "yymmdd#NNN"
function formatBudgetRef(num) {
  if (num == null) return '';
  let s = String(num);
  if (s === '(nuevo)') return s;
  if (s.includes('-')) return s;
  const m = s.match(/^(\d{6})(\d{3,})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return s;
}

// formatInvoiceRef - devuelve la representación de número de factura
function formatInvoiceRef(inv) {
  const invRaw = inv?.number ?? inv?.invoiceNumber ?? '';
  if (typeof invRaw === 'number') {
    const s = String(invRaw);
    if (/^\d{9}$/.test(s)) return formatBudgetRef(s);
    return String(invRaw).padStart(3,'0');
  }
  const s = String(invRaw || '');
  const res = formatBudgetRef(s);
  return res || '(sin número)';
}

function today() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// [SECCIÓN: LIMPIEZA DE DESCRIPCIONES DE ÍTEMS]
// La descripción de cada ítem de presupuesto/factura se edita en un campo "contenteditable"
// (no un <textarea> común), así que lo que se guarda en la base de datos es HTML real, no texto
// plano — por eso permite renglones (<br>). El problema: si alguien pega texto copiado desde
// Word, Gmail, o una página web, el navegador puede traer pegado TODO el estilo original de esa
// fuente (por ejemplo un <br style="--tw-...montones-de-props...">), que no se nota en pantalla
// (esos estilos no significan nada fuera de esa página) pero termina imprimiéndose LETRA POR
// LETRA como texto en el PDF si se escapa con esc() — eso es lo que inflaba el PDF a varias
// páginas de texto ilegible. Esta función limpia esa basura: saca CUALQUIER atributo (style,
// class, etc.) y solo deja pasar <br>, <b>, <strong>, <i>, <em>, <u> — el resto de las etiquetas
// se "desenvuelve" (se conserva el texto de adentro, se descarta la etiqueta). Se usa en el PDF
// en lugar de esc() para las descripciones de ítems. El handleDescPaste() de más abajo evita que
// esta basura se vuelva a guardar para ítems nuevos.
function sanitizeItemDescriptionHtml(html) {
  if (!html) return '';
  const container = document.createElement('div');
  container.innerHTML = html;
  const ALLOWED_TAGS = { BR: true, B: true, STRONG: true, I: true, EM: true, U: true };
  const BLOCK_TAGS = { DIV: true, P: true, LI: true, TR: true };
  (function clean(node) {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === 1) { // elemento
        clean(child);
        if (ALLOWED_TAGS[child.tagName]) {
          while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
        } else {
          // Etiqueta no permitida (incluye la basura tipo <br style="--tw-...">): se saca la
          // etiqueta pero se conserva su contenido/texto. Si era un bloque (div/p/li/tr) se
          // agrega un <br> para no pegar el texto de golpe con lo siguiente.
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          if (BLOCK_TAGS[child.tagName]) node.insertBefore(document.createElement('br'), child);
          node.removeChild(child);
        }
      } else if (child.nodeType === 8) { // comentario HTML: afuera
        node.removeChild(child);
      }
    });
  })(container);
  return container.innerHTML;
}

// Pega el texto del portapapeles como texto PLANO (sin negrita/color/estilos) dentro de los
// campos de descripción de ítems. Sin esto, copiar/pegar desde Word, Gmail o una web arrastra
// el HTML/CSS original de esa fuente y termina imprimiéndose tal cual en el PDF (ver
// sanitizeItemDescriptionHtml de arriba). Los saltos de línea SÍ se conservan como <br>.
function handleDescPaste(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain') || '';
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const lines = text.split(/\r\n|\r|\n/);
  const frag = document.createDocumentFragment();
  let lastNode = null;
  lines.forEach((line, idx) => {
    if (idx > 0) frag.appendChild(document.createElement('br'));
    lastNode = document.createTextNode(line);
    frag.appendChild(lastNode);
  });
  range.insertNode(frag);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.setEndAfter(lastNode);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  e.target.dispatchEvent(new Event('input', { bubbles: true }));
}

function placeCaretAtEnd(el) {
  if (!el) return;
  el.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

window.invDescKeyDown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    window.addInvRow();
  }
};

let _formatSelection = null;

window.rememberFormatSelection = function(editor) {
  const selection = window.getSelection();
  if (!editor || !selection || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return;
  _formatSelection = { editor, range: range.cloneRange() };
};

window.execFormat = function(command, value) {
  try {
    const saved = _formatSelection;
    if (!saved?.editor?.isConnected) return;

    saved.editor.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(saved.range);
    document.execCommand(command, false, value || null);
    window.rememberFormatSelection(saved.editor);

    const row = saved.editor.closest('tr');
    const index = Number((row?.id || '').match(/-(\d+)$/)?.[1]);
    if (!Number.isInteger(index)) return;
    if (row.id.startsWith('inv-li-row-') && typeof window.updateInvRow === 'function') window.updateInvRow(index);
    else if (row.id.startsWith('li-row-') && typeof window.updateLiRow === 'function') window.updateLiRow(index);
  } catch (error) {
    console.warn('Format error', error);
  }
};

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const node = selection.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const editor = element?.closest?.('.li-desc[contenteditable="true"]');
  if (editor) window.rememberFormatSelection(editor);
});

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
  renderReportingYearMenu();
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
  const s = DB.getDashboardStats(_reportingYear);
  const fmtRaw = n => {
    const val = Number(n) || 0;
    const s = `$${Math.abs(val).toLocaleString('es-AR', {minimumFractionDigits:0, maximumFractionDigits:0})}`;
    return val < 0 ? `<span class="text-red-600">-${s}</span>` : s;
  };

  const kpis = [
    { label: 'Proyectos activos',       value: s.activeProjects,    icon: 'folder',  color: 'blue' },
    { label: 'Presupuestos pendientes', value: s.pendingBudgets,    icon: 'clock',   color: 'yellow' },
    { label: 'Presupuestos cancelados', value: s.cancelledBudgets,  icon: 'cancel',  color: 'red' },
    { label: 'Ganancias totales (USD)', value: fmtRaw(s.totalEarnings), icon: 'dollar', color: 'green' },
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
  const recentProjects = (DB.getAll('projects') || []).filter(project => recordYear(project) === _reportingYear).sort((a,b) => {
    const ta = parseToMs(a.date || a.createdAt || a.created || a.created_at);
    const tb = parseToMs(b.date || b.createdAt || b.created || b.created_at);
    return tb - ta;
  }).slice(0,5);
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
                <div class="text-xs text-gray-400 mt-0.5">${usdEquivalentNote('ARG', s.earningsARG_USD)}</div>
              </div>
            </div>
          </div>
          <div class="p-4 rounded-xl" style="background: ${ADMIN.PERU.flagColor}10; border: 2px solid ${ADMIN.PERU.flagColor}30">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background: ${ADMIN.PERU.flagColor}; color: white; font-weight: 700; font-size: 14px;">${ADMIN.PERU.flag}</div>
              <div>
                <p class="text-xs font-semibold text-gray-500 uppercase">Perú</p>
                <p class="text-xl font-bold" style="color: ${ADMIN.PERU.flagColor}">${fmtCurrency(s.earningsPERU, 'PERU')}</p>
                <div class="text-xs text-gray-400 mt-0.5">${usdEquivalentNote('PERU', s.earningsPERU_USD)}</div>
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
        <p class="text-xs text-gray-400 mt-4">El equivalente en USD es información interna: se calcula con el tipo de cambio que cargues en cada proyecto y sirve para comparar administraciones. Nunca se muestra al cliente.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <!-- Chart -->
        <div class="lg:col-span-3 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 class="font-semibold text-gray-900 mb-1">Ganancias ${_reportingYear} (USD)</h3>
          <p class="text-xs text-gray-400 mb-4">Enero a diciembre, normalizado a dólares para comparar Argentina, Perú y USA.</p>
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
    try {
      const canvas = document.getElementById('dash-chart');
      if (!canvas) return;
      if (typeof window.Chart === 'undefined') {
        canvas.parentElement.innerHTML = '<p class="text-sm text-gray-400">Gráfico no disponible (Chart.js no cargado).</p>';
        return;
      }
      const ctx = canvas.getContext ? canvas.getContext('2d') : canvas;
      const months = DB.getMonthlyData(_reportingYear) || [];
      const labels = months.map(m => m.label || '');
      const dataARG = months.map(m => Number(m.earningsARG || 0));
      const dataPERU = months.map(m => Number(m.earningsPERU || 0));
      const dataUSA = months.map(m => Number(m.earningsUSA || 0));
      const totalValues = dataARG.concat(dataPERU, dataUSA).reduce((s, v) => s + Math.abs(Number(v) || 0), 0);
      if (!totalValues) {
        // no data to display — show a friendly placeholder
        if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = `<div class="p-6 text-center text-sm text-gray-400">No hay datos normalizados a USD para ${_reportingYear}.<br><small>Revisá que los proyectos ARG/PERU de ese año tengan cargado el tipo de cambio.</small></div>`;
        return;
      }
      _dashChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Argentina (USD)', data: dataARG, backgroundColor: ADMIN.ARG.flagColor + '80', borderColor: ADMIN.ARG.flagColor, borderWidth: 1.5, borderRadius: 6 },
          { label: 'Perú (USD)', data: dataPERU, backgroundColor: ADMIN.PERU.flagColor + '80', borderColor: ADMIN.PERU.flagColor, borderWidth: 1.5, borderRadius: 6 },
          { label: 'USA (USD)', data: dataUSA, backgroundColor: ADMIN.USA.flagColor + '80', borderColor: ADMIN.USA.flagColor, borderWidth: 1.5, borderRadius: 6 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, boxWidth: 12, boxHeight: 12 } } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { family: 'Inter', size: 11 } } }
        }
      }
      });
    } catch (err) {
      console.error('Error creando gráfico de dashboard:', err);
      const canvas = document.getElementById('dash-chart');
      if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = '<p class="text-sm text-gray-400">No se pudo renderizar el gráfico.</p>';
    }
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

  const projects = (DB.getAll('projects') || []).filter(project => recordYear(project) === _reportingYear);
  // Helper to convert different date formats to milliseconds
  const toMs = (v) => {
    if (!v) return 0;
    // Firebase Timestamp (compat or modular)
    if (typeof v === 'object' && v !== null && typeof v.seconds === 'number') {
      return (v.seconds * 1000) + (v.nanoseconds ? Math.round(v.nanoseconds / 1e6) : 0);
    }
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Date.parse(v);
      if (!isNaN(n)) return n;
      // Try dd/mm/yyyy or d/m/yyyy
      const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const day = Number(m[1]);
        const month = Number(m[2]) - 1;
        const year = Number(m[3]);
        return new Date(year, month, day).getTime();
      }
      return 0;
    }
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'object' && typeof v.toDate === 'function') {
      try { return v.toDate().getTime(); } catch (e) { return 0; }
    }
    return 0;
  };

  // Prefer the explicit project `date` (what user sees) for ordering.
  // Fallback to createdAt / created timestamps if `date` is not provided.
  const pick = (p) => (p && (p.date || p.createdAt || p.created || p.created_at || p.startDate || p.start_date)) || 0;

  projects.sort((a, b) => {
    const ta = toMs(pick(a));
    const tb = toMs(pick(b));
    return tb - ta; // most recent first
  });

  const rowsHTML = projects.length ? projects.map(p => {
    const fin = DB.getProjectFinancials(p.id);
    const adm = ADMIN[p.administration] || ADMIN.ARG;
    return `<tr onclick="navigate('#/projects/${p.id}')" class="cursor-pointer" data-admin="${esc(p.administration || '')}" data-status="${esc(p.status || '')}">
      <td>
        <div class="font-semibold text-gray-900">${esc(p.name)}</div>
        <div class="text-xs text-gray-400 mt-0.5">${esc(p.client||'—')}</div>
      </td>
      <td class="nowrap-cell">${adminBadge(p.administration)}</td>
      <td>${badge(p.status, PROJECT_STATUS)}</td>
      <td class="text-gray-700 font-medium nowrap-cell">${fmtCurrency(fin.totalIncome, p.administration)}</td>
       <td class="font-medium nowrap-cell ${fin.profit >= 0 ? 'text-green-600' : 'text-red-600'}">${fmtCurrency(fin.profit, p.administration)}</td>
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
    // Estado y administración se comparan contra los data-* de la fila, no contra el texto:
    // un proyecto USA con "Argentina" en el nombre aparecía al filtrar por Argentina.
    const matches = (!q || txt.includes(q)) &&
      (!fst || r.dataset.status === fst) &&
      (!fadm || r.dataset.admin === fadm);
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
              ${Object.entries(PROJECT_STATUS).map(([k,v]) => `<option value="${k}" ${project?.status===k||(!project&&k==='pendiente')?'selected':''}>${v.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-group" id="pf-fx-wrap" style="${(project?.administration||'ARG')==='USA' ? 'display:none' : ''}">
          <label class="form-label">Tipo de cambio USD (uso interno)</label>
          <input id="pf-fx-rate" type="number" min="0" step="0.01" class="form-input" placeholder="Ej: 1500 (valor del dólar)" value="${project?.exchangeRateToUSD || ''}">
          <p class="text-xs text-gray-400 mt-1">Se usa solo para normalizar este proyecto a dólares en los gráficos de Inicio y Administraciones. No aparece en presupuestos ni facturas.</p>
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
        const fxWrap = document.getElementById('pf-fx-wrap');
        if (fxWrap) fxWrap.style.display = adm === 'USA' ? 'none' : '';
      };
    },
    preConfirm: () => {
      const name = document.getElementById('pf-name').value.trim();
      if (!name) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
      const admValue = document.getElementById('pf-admin').value;
      const fxRateVal = document.getElementById('pf-fx-rate')?.value;
      return {
        name, client: document.getElementById('pf-client').value.trim(),
        date: document.getElementById('pf-date').value,
        administration: admValue,
        currency: ADMIN[admValue]?.code || 'ARS',
        status: document.getElementById('pf-status').value,
        notes: document.getElementById('pf-notes').value.trim(),
        exchangeRateToUSD: admValue === 'USA' ? undefined : (Number(fxRateVal) || undefined),
      };
    }
  }).then(async r => {
    if (!r.isConfirmed) return navigate(id ? `#/projects/${id}` : '#/projects');
    try {
      notify('Guardando proyecto...', 'info');
        if (id) {
          const oldProject = DB.get('projects', id) || {};
          await DB.update('projects', id, r.value);
          notify('Proyecto actualizado');
          // If status changed to 'cobrado', mark incomes and invoices as paid
          try {
            if ((oldProject.status !== r.value.status) && r.value.status === 'cobrado') {
              const todayStr = new Date().toISOString().slice(0,10);
              // Mark incomes as cobrado
              (DB.getIncomesByProject(id) || []).forEach(i => {
                if (!i.paid) DB.update('incomes', i.id, { paid: true, cobradoDate: todayStr });
              });
              // Mark invoices as cobrado
              (DB.getInvoicesByProject(id) || []).forEach(inv => {
                if (inv.status !== 'cobrado') DB.update('invoices', inv.id, { status: 'cobrado', cobradoDate: todayStr });
              });
              notify('Proyecto marcado como Cobrado: ingresos y facturas actualizados', 'success');
            }
          } catch (e) { console.error('Error marcando cobros:', e); }
          navigate(`#/projects/${id}`);
        } else {
          const p = await DB.add('projects', r.value);
          notify('Proyecto creado');
          navigate(`#/projects/${p.id}`);
        }
    } catch (error) {
      console.error('Error guardando proyecto:', error);
      notify('No se pudo guardar el proyecto', 'error');
    }
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
async function renderProjectDetail(id, tab = 'info') {
  let project = DB.get('projects', id);
  if (!project) {
    console.warn('renderProjectDetail: project not found for id=', id, 'existing projects=', DB.getAll('projects').map(p => p.id));
    notify('Proyecto no encontrado', 'error');
    return navigate('#/projects');
  }
  if (tab === 'invoices') {
    const currentHash = window.location.hash;
    try {
      await ensureInvoicesFromApprovedBudgets(project);
    } catch (error) {
      console.error('Error creando facturas pendientes:', error);
      notify('No se pudieron crear las facturas pendientes: ' + error.message, 'error');
    }
    if (window.location.hash !== currentHash) return;
    project = DB.get('projects', id) || project;
  }

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
            ${((fin) => ['totalIncome','totalExpense','profit'].map((k,i) => {
              const labels = ['Ingresos','Gastos','Ganancia'];
              const colors = ['text-green-600','text-red-600', fin.profit >= 0 ? 'text-green-600':'text-red-600'];
              return `<div><p class="text-xs text-gray-400 mb-1">${labels[i]}</p><p class="font-bold ${colors[i]}">${fmtCurrency(fin[k], project.administration)}</p></div>`;
            }).join(''))(DB.getProjectFinancials(id))}
          </div>
        </div>
      </div>

      ${tabBar}
      ${content}
    </div>
  `);

  // Si el usuario quiere URLs compactas, reemplazamos la URL visible para ocultar el ID
  try {
    if (String(localStorage.getItem('aurea_compact_urls')) === 'true') {
      const shortHash = '#/projects' + (tab ? `/${tab}` : '');
      history.replaceState(null, '', window.location.pathname + window.location.search + shortHash);
    }
  } catch (e) {
    console.warn('No se pudo compactar la URL del proyecto:', e);
  }
}

function renderTabInfo(p) {
  return `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
        <div class="flex items-center justify-between border-b border-gray-100 pb-3">
          <h3 class="font-semibold text-gray-900">Datos del Proyecto</h3>
          <button class="btn btn-sm btn-secondary" onclick="showEditProject('${p.id}')">Editar</button>
        </div>
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
      ${p.administration !== 'USA' ? (() => {
        const fin = DB.getProjectFinancials(p.id);
        const rate = fin.exchangeRateToUSD || 0;
        // OJO: esta celda es EDITABLE directamente acá (input + botón Guardar) — antes
        // esta tarjeta era solo de lectura y para cambiar el tipo de cambio había que
        // abrir el modal "Editar Proyecto" desde otro botón, lo cual generaba confusión
        // (el usuario ve el número acá abajo pero no puede tocarlo). Ver
        // saveProjectFxRateInline más abajo, que guarda con DB.update y refresca la pestaña.
        return `
        <div class="bg-white border border-gray-200 rounded-2xl p-6 md:col-span-2" style="border-style:dashed">
          <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 class="font-semibold text-gray-900">Tipo de cambio (uso interno)</h3>
            <span class="badge badge-gray text-xs">No aparece en presupuestos ni facturas</span>
          </div>
          <div class="flex items-end gap-3 flex-wrap mb-4">
            <div class="form-group mb-0" style="max-width:220px">
              <label class="form-label">Valor del dólar hoy (1 USD = ? ${ADMIN[p.administration]?.code||''})</label>
              <input id="proj-fx-rate-inline" type="number" min="0" step="0.01" class="form-input" placeholder="Ej: 1500" value="${rate || ''}" onkeydown="if(event.key==='Enter'){event.preventDefault();saveProjectFxRateInline('${p.id}');}">
            </div>
            <button class="btn btn-primary btn-sm" onclick="saveProjectFxRateInline('${p.id}')">Guardar</button>
          </div>
          ${rate > 0 ? `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
              <div><p class="text-xs text-gray-400 mb-1">Presupuesto aprobado en USD</p><p class="font-bold text-gray-900">${fmtCurrency(fin.budgetTotalUSD, 'USA')}</p></div>
              <div><p class="text-xs text-gray-400 mb-1">Ganancia en USD</p><p class="font-bold ${fin.profitUSD>=0?'text-green-600':'text-red-600'}">${fmtCurrency(fin.profitUSD, 'USA')}</p></div>
            </div>
          ` : `<p class="text-sm text-gray-400">Cargá el valor del dólar arriba y guardá para ver el presupuesto y la ganancia normalizados a USD (se usa en los gráficos de Inicio y Administraciones).</p>`}
        </div>`;
      })() : ''}
    </div>
  `;
}

// saveProjectFxRateInline - Guarda el tipo de cambio (uso interno) directamente desde la
// tarjeta de la pestaña "Información general" del proyecto, sin pasar por el modal
// "Editar Proyecto". Deja el campo vacío/en 0 como "sin cargar" (undefined), igual que en
// el formulario de edición completo.
window.saveProjectFxRateInline = async function(projectId) {
  const input = document.getElementById('proj-fx-rate-inline');
  const rate = Number(input?.value) || undefined;
  try {
    await DB.update('projects', projectId, { exchangeRateToUSD: rate });
    notify('Tipo de cambio guardado');
    renderProjectDetail(projectId, 'info');
  } catch (e) {
    console.error('Error guardando tipo de cambio del proyecto:', e);
    notify('No se pudo guardar el tipo de cambio', 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// PRESUPUESTOS (tab dentro de proyecto)
// ═══════════════════════════════════════════════════════════════
function renderTabBudgets(project) {
  const budgets = DB.getBudgetsByProject(project.id).sort((a,b) => (a.number||0) - (b.number||0));
  const rowsHTML = budgets.length ? budgets.map(b => {
    const total = calcBudgetTotal(b.items || [], b.administration, getBudgetIvaMode(b));
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
function getTaxLabel(administration = null, includeRate = true) {
  const adm = String(administration || '').toUpperCase();
  if (adm === 'PERU') return includeRate ? 'IGV 18%' : 'IGV';
  if (adm === 'ARG') return includeRate ? 'IVA 21%' : 'IVA';
  return includeRate ? 'IVA 21%' : 'IVA';
}

function syncBudgetTaxLabel(administration = null) {
  const adm = String(administration || '').toUpperCase();
  const label = document.querySelector('#budget-breakdown .text-blue-700 span:first-child');
  const label2 = document.querySelector('.text-blue-700 span:first-child');
  const target = label || label2;
  if (target) target.textContent = getTaxLabel(adm, true);
}

function calcBudgetBreakdown(items, administration = null, ivaMode = null) {
  const base = items.reduce((s, it) => s + ((Number(it.qty)||0) * (Number(it.unitPrice)||0)), 0);
  const adm = String(administration || '').toUpperCase();
  const mode = ivaMode || 'sin';
  const subtotal = Number(base.toFixed(2));
  const taxRate = (adm === 'ARG' && mode === 'con') ? 0.21 : ((adm === 'PERU' && mode === 'con') ? 0.18 : 0);
  const ivaAmount = Number((base * taxRate).toFixed(2));
  return {
    subtotal,
    iva: ivaAmount,
    total: Number((subtotal + ivaAmount).toFixed(2)),
  };
}

function calcBudgetTotal(items, administration = null, ivaMode = null) {
  return calcBudgetBreakdown(items, administration, ivaMode).total;
}

function calcApprovedTotal(items, administration = null, ivaMode = null) {
  const base = items.filter(it => it.aprobado).reduce((s, it) => s + ((Number(it.qty)||0) * (Number(it.unitPrice)||0)), 0);
  const adm = String(administration || '').toUpperCase();
  const mode = ivaMode || 'sin';
  const subtotal = Number(base.toFixed(2));
  const taxRate = (adm === 'ARG' && mode === 'con') ? 0.21 : ((adm === 'PERU' && mode === 'con') ? 0.18 : 0);
  const ivaAmount = Number((base * taxRate).toFixed(2));
  return Number((subtotal + ivaAmount).toFixed(2));
}

// getBudgetIvaMode - Determina de forma consistente si un presupuesto debe calcularse
// CON impuesto (IVA/IGV) o SIN él, a partir de los datos ya guardados en el presupuesto.
// - Perú: el IGV (18%) es obligatorio, siempre se aplica sobre el total.
// - Argentina: el IVA (21%) es opcional, solo se aplica si el usuario marcó "+IVA" (budget.iva === 'con').
// - USA y cualquier otra administración: no aplica impuesto.
// IMPORTANTE: usar siempre este helper (en vez de repetir la lógica a mano) al calcular montos
// totales de un presupuesto ya guardado (listados, PDF, resúmenes, ingresos automáticos, etc.)
// para evitar que el IVA/IGV quede afuera del total por error.
function getBudgetIvaMode(budget) {
  const adm = String(budget?.administration || '').toUpperCase();
  if (adm === 'PERU') return 'con';
  if (adm === 'ARG') return budget?.iva === 'con' ? 'con' : 'sin';
  return 'sin';
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
  const rawNum = budget?.number ?? budget?.budgetNumber ?? '(nuevo)';
  const num = rawNum === '(nuevo)' ? rawNum : formatBudgetRef(rawNum);
  const hasProject = !!existingProject;

  setBreadcrumb([
    { label: 'Presupuestos', route: '#/presupuestos' },
    { label: `Presupuesto #${(typeof num === 'number' ? String(num).padStart(3,'0') : String(num))}` },
  ]);
  
  // Mostrar botón de aprobar en todos los presupuestos que existen y NO tengan proyecto asociado
  const canApprove = budget && !existingProject;
  const isApproved = false; // Budgets can always be edited, even when approved
  
  const canCreateInvoiceFromBudget = !!budget && canGenerateInvoicesForProject(budget.administration || (existingProject && existingProject.administration)) && ['aprobado-total','aprobado-parcial'].includes(budget.status);
  setActions(`
    <button class="btn btn-secondary btn-sm" onclick="navigate('#/presupuestos')">← Volver</button>
    ${budget ? `<button class="btn btn-secondary btn-sm" onclick="previewBudgetPDF('${budgetId}')" style="margin-right:8px">Vista previa</button>
    <button class="btn btn-secondary btn-sm" onclick="exportBudgetPDF('${budgetId}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
      PDF
    </button>` : ''}
    ${canApprove ? `<button class="btn btn-primary btn-sm" onclick="showApprovalModal('${budgetId}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      Aprobar Presupuesto
    </button>` : ''}
    ${canCreateInvoiceFromBudget ? `<button class="btn btn-warning btn-sm" onclick="createInvoiceFromBudget('${budgetId}')" style="margin-left:8px">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v8m4-4H8"/></svg>
      Crear factura desde presupuesto
    </button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="saveBudgetForm('${projectId||''}','${budgetId||''}')">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"/></svg>
      Guardar
    </button>
  `);

  const items = budget?.items || [{ description: '', qty: 1, unitPrice: 0, aprobado: false }];
  const clients = DB.getAll('clients');
  // Si el presupuesto ya está vinculado a un proyecto, el cliente que se muestra/edita acá
  // es el del proyecto (existingProject.client); si no, es el del propio presupuesto.
  const selectedClientName = hasProject ? (existingProject.client || '') : (budget?.clientName || '');
  const hasSelectedClient = selectedClientName && !clients.some(c => c.name === selectedClientName);
  const clientOptions = clients.map(c => `<option value="${esc(c.name)}" ${selectedClientName === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const clientSelectOptions = `${clientOptions}${hasSelectedClient ? `<option value="${esc(selectedClientName)}" selected>${esc(selectedClientName)}</option>` : ''}<option value="__new_client__">+ Nuevo cliente</option>`;
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
      <td>
        <div class="li-desc" data-placeholder="Descripción del ítem..." contenteditable="${!isReadOnly}" oninput="updateLiRow(${i})" onkeydown="liDescKeyDown(event, ${i})" onpaste="handleDescPaste(event)" onfocus="window._currentEditableIndex=${i}">${it.description ? it.description : ''}</div>
      </td>
      <td style="width:80px"><input type="number" min="0" value="${it.qty||1}" oninput="updateLiRow(${i})" id="li-qty-${i}" ${isReadOnly ? 'disabled' : ''}></td>
      <!-- P. Unitario SIN min="0": a propósito, para poder cargar ítems en negativo (por
           ejemplo una fila "Bonificación 10%" con precio unitario -20) y que se descuenten
           del total del presupuesto. Ver calcBudgetBreakdown más arriba — suma qty*unitPrice
           tal cual, sin recortar valores negativos, así que un ítem negativo funciona igual
           en el total, en el PDF y en el cálculo de IVA/IGV (se aplica sobre el neto). -->
      <td style="width:130px"><input type="number" step="0.01" value="${it.unitPrice||0}" oninput="updateLiRow(${i})" id="li-up-${i}" ${isReadOnly ? 'disabled' : ''}></td>
      <td style="width:150px;text-align:right;padding-right:12px;font-weight:600;color:#374151" id="li-total-${i}">${fmtCurrency((it.qty||1)*(it.unitPrice||0), budget?.administration || existingProject?.administration || 'ARG')}</td>
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

  const administrationKey = (budget?.administration || existingProject?.administration || 'ARG');
  const currentTaxChecked = document.getElementById('b-iva-con')?.checked ?? (administrationKey === 'PERU' ? true : false);
  const ivaMode = (administrationKey === 'ARG' || administrationKey === 'PERU')
    ? ((budget?.iva === 'con' || currentTaxChecked) ? 'con' : 'sin')
    : 'sin';
  const totalAprobado = calcApprovedTotal(items, administrationKey, ivaMode);
  const total = calcBudgetTotal(items, administrationKey, ivaMode);
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
              ${(() => {
                const admKey = (budget?.administration || existingProject?.administration || 'ARG');
                if (admKey === 'PERU') return `<p class="text-xs text-gray-500 mt-1">+ IGV</p>`;
                if (admKey === 'ARG') return `<p class="text-xs text-gray-500 mt-1">+ IVA</p>`;
                return '';
              })()}
              ${existingProject ? `<a onclick="navigate('#/projects/${existingProject.id}')" class="text-xs text-green-700 font-semibold underline cursor-pointer mt-1 inline-block">Ver proyecto →</a>` : ''}
            </div>
          </div>
        </div>
      ` : ''}

      <!-- Header info -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="form-group mb-0">
            <label class="form-label">Nombre del Proyecto${!hasProject ? ' *' : ''}</label>
            <input id="b-project-name" class="form-input" value="${esc(hasProject ? existingProject.name : (budget?.projectName||''))}" placeholder="Ej: Evento Corporativo 2026">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Cliente${!hasProject ? ' *' : ''}</label>
            <select id="b-client" class="form-select">
              <option value="">Seleccionar cliente</option>
              ${clientSelectOptions}
            </select>
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Administración${!hasProject ? ' *' : ''}</label>
            <select id="b-admin" class="form-select">
              ${Object.entries(ADMIN).map(([k,v]) => `<option value="${k}" ${(hasProject ? existingProject.administration : (budget?.administration||'ARG'))===k?'selected':''}>${v.flag} ${v.label} (${v.code})</option>`).join('')}
            </select>
            ${hasProject ? `<p class="text-xs text-amber-600 mt-1">Este cambio se aplica a TODO el proyecto "${esc(existingProject.name)}" (todos sus presupuestos, ingresos y totales), no solo a este presupuesto.</p>` : ''}
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Fecha del Presupuesto</label>
            <input id="b-date" type="date" class="form-input" value="${budget?.date||today()}">
          </div>
        </div>
        ${hasProject ? `<p class="text-xs text-gray-400 mt-3">Nombre, cliente y administración pertenecen al proyecto "${esc(existingProject.name)}" — al guardar este presupuesto, también se actualiza el proyecto.</p>` : ''}
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
        <div id="iva-block" class="mt-3" style="${((budget?.administration||'ARG') === 'ARG' || (budget?.administration||'ARG') === 'PERU') ? '' : 'display:none'}">
          <div class="form-group mb-0">
            <label class="form-label">${(budget?.administration||'ARG') === 'PERU' ? 'IGV' : 'IVA'}</label>
            <div style="display:flex;gap:12px;align-items:center">
              <label class="inline-flex items-center"><input type="checkbox" id="b-iva-con" ${(budget?.iva==='con' || (budget?.administration||'ARG') === 'PERU') ? 'checked' : ''} onchange="toggleIVA('con')"> <span style="margin-left:8px">+${(budget?.administration||'ARG') === 'PERU' ? 'IGV' : 'IVA'}</span></label>
              <label class="inline-flex items-center"><input type="checkbox" id="b-iva-sin" ${budget?.iva==='sin' ? 'checked' : ''} onchange="toggleIVA('sin')"> <span style="margin-left:8px">Sin ${(budget?.administration||'ARG') === 'PERU' ? 'IGV' : 'IVA'}</span></label>
            </div>
          </div>
        </div>
      </div>

      <!-- Datos del evento (opcionales, salen impresos en el PDF del presupuesto) -->
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 class="font-semibold text-gray-900 mb-4">Datos del Evento <span class="text-xs font-normal text-gray-400">(opcional, aparece en el PDF)</span></h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="form-group mb-0">
            <label class="form-label">País</label>
            <input id="b-country" class="form-input" value="${esc(budget?.country||'')}" placeholder="Ej: Argentina">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Ciudad</label>
            <input id="b-city" class="form-input" value="${esc(budget?.city||'')}" placeholder="Ej: Buenos Aires">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Fecha del Evento</label>
            <input id="b-event-date" type="date" class="form-input" value="${budget?.eventDate||''}">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Tipo de Proyecto</label>
            <input id="b-project-type" class="form-input" value="${esc(budget?.projectType||'')}" placeholder="Ej: Producción audiovisual">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Fecha de Armado</label>
            <input id="b-assembly-date" type="date" class="form-input" value="${budget?.assemblyDate||''}">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Fecha de Montaje</label>
            <input id="b-setup-date" type="date" class="form-input" value="${budget?.setupDate||''}">
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div class="form-group mb-0">
            <label class="form-label">Venue (nombre del lugar)</label>
            <input id="b-venue-name" class="form-input" value="${esc(budget?.venueName||'')}" placeholder="Ej: Facultad de Derecho">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Venue (dirección)</label>
            <input id="b-venue-address" class="form-input" value="${esc(budget?.venueAddress||'')}" placeholder="Ej: Av. Pres. Figueroa Alcorta 2263">
          </div>
        </div>
      </div>

      <!-- Line items -->
      <div class="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div class="p-4 border-b border-gray-100 flex items-center justify-between" style="background: #F9F9F9">
          <h3 class="font-semibold text-gray-900">Ítems del Presupuesto</h3>
          <span class="text-xs font-semibold admin-badge" style="color: ${adm.flagColor}">${adm.flag} ${adm.label} · ${adm.code}</span>
        </div>
        <div class="p-3 border-b border-gray-100" style="background:#fff">
          <div id="li-toolbar" style="display:flex;gap:8px;align-items:center">
            <button type="button" class="btn btn-sm btn-secondary" onmousedown="event.preventDefault()" onclick="execFormat('bold')" title="Negrita"><span style="font-weight:700">N</span></button>
            <button type="button" class="btn btn-sm btn-secondary" onmousedown="event.preventDefault()" onclick="execFormat('italic')" title="Cursiva"><span style="font-style:italic;font-weight:600">K</span></button>
            <select onchange="execFormat('fontSize', this.value)" class="form-select" style="max-width:120px">
              <option value="">Tamaño</option>
              <option value="2">Pequeño</option>
              <option value="3">Normal</option>
              <option value="5">Grande</option>
            </select>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="li-table w-full" id="li-table">
            <thead>
              <tr style="background: #F9F9F9">
                ${showApprovalCol ? '<th style="width:60px;text-align:center">✓ Aprobado</th>' : ''}
                <th style="min-width:200px">Descripción</th>
                <th style="width:80px">Cant.</th>
                <!-- Unidad column removed per request -->
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
            <div id="budget-breakdown" class="mb-3 min-w-[220px] text-sm text-gray-600 ${((administrationKey === 'ARG' || administrationKey === 'PERU') && (budget?.iva === 'con' || document.getElementById('b-iva-con')?.checked)) ? '' : 'hidden'}">
              <div class="flex justify-between gap-4 mb-1">
                <span>Subtotal</span>
                <span id="b-subtotal">${fmtCurrency(calcBudgetBreakdown(items, administrationKey, ivaMode).subtotal, administrationKey)}</span>
              </div>
              <div class="flex justify-between gap-4 text-blue-700" style="display:${((administrationKey === 'ARG' || administrationKey === 'PERU') && (budget?.iva === 'con' || document.getElementById('b-iva-con')?.checked)) ? 'flex' : 'none'}">
                <span>${getTaxLabel(administrationKey, true)}</span>
                <span id="b-iva-amount">+ ${fmtCurrency(calcBudgetBreakdown(items, administrationKey, ivaMode).iva, administrationKey)}</span>
              </div>
            </div>
            <p class="text-xs text-gray-500 mb-1">TOTAL PRESUPUESTO</p>
            <p class="text-2xl font-bold text-gray-900" id="b-total">${fmtCurrency(total, budget?.administration || 'ARG')}</p>
          </div>
        </div>
      </div>

      <!-- [SECCIÓN: TIPO DE CAMBIO] — el campo "Tipo de cambio (uso interno)" que antes
           estaba acá se sacó del formulario de Presupuestos. Ahora se carga únicamente
           desde el Proyecto (pestaña "Información general", abajo de todo) — buscar
           "pf-fx-rate" en la sección PROYECTOS — Formulario más arriba en este archivo.
           Los presupuestos viejos que ya tenían un valor guardado lo siguen respetando
           como respaldo (ver DB._effectiveExchangeRate), pero ya no se edita desde acá. -->

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
  window._budgetAdm = budget?.administration || existingProject?.administration || 'ARG';
  window._liItems = items.map(it => ({ ...it }));
  window._budgetIsApproved = false; // Always allow editing
  window._currentBudgetStatus = budget?.status || 'borrador';
  window._budgetHasProject = !!existingProject;

  const clientSelect = document.getElementById('b-client');
  if (clientSelect) {
    clientSelect.value = clientSelect.value || (selectedClientName || '');
    clientSelect.addEventListener('change', (e) => {
      if (e.target.value === '__new_client__') {
        showClientModal(null, (newClient) => {
          const clients = DB.getAll('clients');
          const current = document.getElementById('b-client');
          if (!current) return;
          const options = [`<option value="">Seleccionar cliente</option>`]
            .concat(clients.map(c => `<option value="${esc(c.name)}" ${newClient && c.name === newClient.name ? 'selected' : ''}>${esc(c.name)}</option>`))
            .concat(['<option value="__new_client__">+ Nuevo cliente</option>'])
            .join('');
          current.innerHTML = options;
          if (newClient) current.value = newClient.name;
        });
        e.target.value = selectedClientName || '';
      }
    });
  }

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
      const ivaBlock = document.getElementById('iva-block');
      const taxSupported = e.target.value === 'ARG' || e.target.value === 'PERU';
      if (ivaBlock) ivaBlock.style.display = taxSupported ? '' : 'none';

      const label = document.querySelector('#iva-block .form-label');
      const ivaText = document.querySelector('#iva-block #b-iva-con + span');
      const sinText = document.querySelector('#iva-block #b-iva-sin + span');
      const isPeru = e.target.value === 'PERU';
      if (label) label.textContent = isPeru ? 'IGV' : 'IVA';
      if (ivaText) ivaText.textContent = isPeru ? '+IGV' : '+IVA';
      if (sinText) sinText.textContent = isPeru ? 'Sin IGV' : 'Sin IVA';
      syncBudgetTaxLabel(e.target.value);

      if (e.target.value !== 'ARG' && e.target.value !== 'PERU') {
        const con = document.getElementById('b-iva-con');
        const sin = document.getElementById('b-iva-sin');
        if (con) con.checked = false;
        if (sin) sin.checked = false;
      } else {
        const con = document.getElementById('b-iva-con');
        const sin = document.getElementById('b-iva-sin');
        if (con) con.checked = isPeru || e.target.value === 'ARG';
        if (sin) sin.checked = !con.checked;
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

  // IVA toggle helper: Argentina can mark/unmark +IVA or Sin IVA freely.
  // Important: the checkbox state is already updated by the browser when onchange fires,
  // so we must not toggle it again or it will instantly reverse the click.
  window.toggleIVA = function(v) {
    const con = document.getElementById('b-iva-con');
    const sin = document.getElementById('b-iva-sin');
    if (!con || !sin) return;

    const adm = String(window._budgetAdm || '').toUpperCase();
    const supportsTax = adm === 'ARG' || adm === 'PERU';
    if (!supportsTax) return;

    if (v === 'con') {
      con.checked = true;
      sin.checked = false;
    } else if (v === 'sin') {
      con.checked = false;
      sin.checked = true;
    }

    const ivaMode = con.checked ? 'con' : 'sin';
    const total = calcBudgetTotal(window._liItems, window._budgetAdm, ivaMode);
    const approved = calcApprovedTotal(window._liItems, window._budgetAdm, ivaMode);
    const target = document.getElementById('b-total');
    if (target) target.textContent = fmtCurrency(total, window._budgetAdm);
    const partial = document.getElementById('b-approved-total');
    if (partial) partial.textContent = fmtCurrency(approved, window._budgetAdm);
    syncBudgetTaxLabel(String(window._budgetAdm || '').toUpperCase());
    updateTotals();
  };

  window.toggleItemApproval = (i) => {
    window._liItems[i].aprobado = !window._liItems[i].aprobado;
    updateTotals();
  };

  window.updateLiRow = (i) => {
    const rows = document.querySelectorAll('#li-tbody tr');
    const row = rows[i];
    if (!row) return;
    const currentStatus = window._currentBudgetStatus || 'borrador';
    const offset = currentStatus !== 'borrador' ? 1 : 0;
    const descEl = row.querySelector('.li-desc');
    const qtyEl = row.querySelector('input[type="number"]');
    const upEl = row.querySelector('input[id^="li-up-"]');
    const descHtml = descEl ? descEl.innerHTML : (window._liItems[i].description || '');
    const descText = descEl ? descEl.innerText.trim() : '';
    // Normalize empty description
    if (descEl && descText === '') descEl.innerHTML = '';
    if (descEl) descEl.classList.toggle('empty', descEl.innerText.trim() === '');
    window._liItems[i] = {
      ...window._liItems[i],
      description: descHtml,
      qty: Number(qtyEl?.value) || 0,
      unitPrice: Number(upEl?.value) || 0,
    };
    const total = (window._liItems[i].qty) * (window._liItems[i].unitPrice);
    document.getElementById(`li-total-${i}`).textContent = fmtCurrency(total, window._budgetAdm);
    updateTotals();
  };

  window.addLiRow = () => {
    if (window._budgetIsApproved) return;
    window._liItems.push({ description: '', qty: 1, unitPrice: 0, aprobado: false });
    const newIndex = window._liItems.length - 1;
    rebuildLiTable();
    setTimeout(() => {
      const el = document.querySelector(`#li-row-${newIndex} .li-desc`);
      if (el) { el.focus(); placeCaretAtEnd(el); }
    }, 0);
  };

  window.removeLiRow = (i) => {
    if (window._budgetIsApproved) return;
    window._liItems.splice(i, 1);
    rebuildLiTable();
  };

  function updateTotals() {
    const adm = String(window._budgetAdm || '').toUpperCase();
    const conChecked = document.getElementById('b-iva-con')?.checked;
    const ivaMode = (adm === 'ARG' || adm === 'PERU') ? (conChecked ? 'con' : 'sin') : 'sin';
    const breakdown = calcBudgetBreakdown(window._liItems, window._budgetAdm, ivaMode);
    const grand = breakdown.total;
    const approved = calcApprovedTotal(window._liItems, window._budgetAdm, ivaMode);
    const currentStatus = window._currentBudgetStatus || 'borrador';
    const showApprovalCol = currentStatus !== 'borrador';
    const shouldShowVat = (adm === 'ARG' || adm === 'PERU') && conChecked;
    const vatLabel = getTaxLabel(adm, true);
    syncBudgetTaxLabel(adm);
    
    document.getElementById('b-total').textContent = fmtCurrency(grand, window._budgetAdm);
    const subtotalEl = document.getElementById('b-subtotal');
    const ivaEl = document.getElementById('b-iva-amount');
    const vatBox = document.getElementById('budget-breakdown');
    const vatLine = document.querySelector('#budget-breakdown .text-blue-700');

    if (subtotalEl) subtotalEl.textContent = fmtCurrency(breakdown.subtotal, window._budgetAdm);
    if (ivaEl) ivaEl.textContent = `+ ${fmtCurrency(breakdown.iva, window._budgetAdm)}`;
    if (vatBox) vatBox.classList.toggle('hidden', !shouldShowVat);
    if (vatLine) vatLine.style.display = shouldShowVat ? '' : 'none';

    const footerRight = document.querySelector('#li-table').closest('div').querySelector('.p-4.border-t .text-right');
    if (footerRight) {
      if (showApprovalCol && approved > 0 && approved < grand) {
        footerRight.innerHTML = `
          <div class="mb-2">
            <p class="text-xs text-gray-500">Aprobado parcial</p>
            <p class="text-lg font-semibold text-yellow-600" id="b-approved-total">${fmtCurrency(approved, window._budgetAdm)}</p>
          </div>
          <div id="budget-breakdown" class="mb-3 min-w-[220px] text-sm text-gray-600 ${shouldShowVat ? '' : 'hidden'}">
            <div class="flex justify-between gap-4 mb-1">
              <span>Subtotal</span>
              <span id="b-subtotal">${fmtCurrency(breakdown.subtotal, window._budgetAdm)}</span>
            </div>
            <div class="flex justify-between gap-4 text-blue-700" style="display:${shouldShowVat ? 'flex' : 'none'}">
              <span>${vatLabel}</span>
              <span id="b-iva-amount">+ ${fmtCurrency(breakdown.iva, window._budgetAdm)}</span>
            </div>
          </div>
          <p class="text-xs text-gray-500 mb-1">TOTAL PRESUPUESTO</p>
          <p class="text-2xl font-bold text-gray-900" id="b-total">${fmtCurrency(grand, window._budgetAdm)}</p>
        `;
      } else {
        footerRight.innerHTML = `
          <div id="budget-breakdown" class="mb-3 min-w-[220px] text-sm text-gray-600 ${shouldShowVat ? '' : 'hidden'}">
            <div class="flex justify-between gap-4 mb-1">
              <span>Subtotal</span>
              <span id="b-subtotal">${fmtCurrency(breakdown.subtotal, window._budgetAdm)}</span>
            </div>
            <div class="flex justify-between gap-4 text-blue-700" style="display:${shouldShowVat ? 'flex' : 'none'}">
              <span>${vatLabel}</span>
              <span id="b-iva-amount">+ ${fmtCurrency(breakdown.iva, window._budgetAdm)}</span>
            </div>
          </div>
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
        <td><div class="li-desc" data-placeholder="Descripción del ítem..." contenteditable="${!isReadOnly}" oninput="updateLiRow(${i})" onkeydown="liDescKeyDown(event, ${i})" onpaste="handleDescPaste(event)" onfocus="window._currentEditableIndex=${i}">${it.description ? it.description : ''}</div></td>
        <td><input type="number" min="0" value="${it.qty||1}" oninput="updateLiRow(${i})" id="li-qty-${i}" ${isReadOnly ? 'disabled' : ''}></td>
        <!-- Unidad removed -->
        <!-- P. Unitario SIN min="0" a propósito — permite ítems en negativo (bonificaciones/descuentos). Ver la misma fila más arriba en este archivo. -->
        <td><input type="number" step="0.01" value="${it.unitPrice||0}" oninput="updateLiRow(${i})" id="li-up-${i}" ${isReadOnly ? 'disabled' : ''}></td>
        <td style="text-align:right;padding-right:12px;font-weight:600;color:#374151" id="li-total-${i}">${fmtCurrency((it.qty||1)*(it.unitPrice||0), window._budgetAdm)}</td>
        ${!isReadOnly ? `<td><button onclick="removeLiRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td>` : '<td></td>'}
      </tr>
    `}).join('');
    
    // Update table headers — show 'Unidad' only for ARG administration
    const thead = document.querySelector('#li-table thead tr');
    if (thead) {
      const unitCol = '';
      thead.innerHTML = `
        ${showApprovalCol ? '<th style="width:60px;text-align:center">✓ Aprobado</th>' : ''}
        <th style="min-width:200px">Descripción</th>
        <th style="width:80px">Cant.</th>
        ${unitCol}
        <th style="width:130px">P. Unitario</th>
        <th style="width:150px;text-align:right;padding-right:12px">Total</th>
        <th style="width:40px"></th>
      `;
    }
    
    updateTotals();
  }

  // Handle Enter / Shift+Enter in li description cells
  window.liDescKeyDown = function(e, index) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Create new item and focus it
      addLiRow();
    }
    // Shift+Enter default: insert newline
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
  
  const budgetAdministration = budget.administration || 'ARG';
  const budgetIvaMode = budgetAdministration === 'PERU' ? 'con' : (budgetAdministration === 'ARG' && budget.iva === 'con' ? 'con' : 'sin');
  const total = calcBudgetTotal(budget.items || [], budgetAdministration, budgetIvaMode);
  const adm = ADMIN[budgetAdministration];

  const result = await Swal.fire({
    title: 'Aprobar Presupuesto',
    html: `
      <div class="text-left space-y-4" style="font-family: inherit;">
        <p class="text-sm text-gray-600">Al aprobar este presupuesto, se creará automáticamente un proyecto aprobado.</p>
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

    try {
      const now = new Date();
      const history = budget.history || [];
      history.push({
        action: approvalType === 'aprobado-total' ? 'Presupuesto Aprobado Totalmente' : 'Presupuesto Aprobado Parcialmente',
        date: today(),
        time: now.toLocaleTimeString('es-AR'),
        notes: approvalNotes || ''
      });

      // Create new project from budget
      const budgetAdministration = budget.administration || 'ARG';
      const budgetIvaMode = getBudgetIvaMode(budget);
      const approvedAmount = approvalType === 'aprobado-total' ? calcBudgetTotal(budget.items, budgetAdministration, budgetIvaMode) : calcApprovedTotal(budget.items, budgetAdministration, budgetIvaMode);
      const projNum = await DB.nextNumber('projectCounter');
      console.log('Aprobando presupuesto', budgetId, '=> crear proyecto con cantidad aprobada', approvedAmount);
      const newProject = await DB.add('projects', {
        name: budget.projectName || `Proyecto desde ${formatBudgetRef(budget.number ?? budget.budgetNumber ?? '')}`,
        client: budget.clientName || '',
        administration: budget.administration || 'ARG',
        status: 'aprobado',
        date: budget.date || today(),
        budgetId: budgetId,
        budgetAmount: approvedAmount,
        number: projNum
      });

      if (!newProject || !newProject.id) {
        throw new Error('No se pudo crear el proyecto (DB.add devolvió valor inválido)');
      }

      // Automatically create income entry for approved amount
      const bref = formatBudgetRef(budget.number ?? budget.budgetNumber ?? '');
      const incomeDescription = approvalType === 'aprobado-total' 
        ? `Presupuesto aprobado totalmente - ${bref}` 
        : `Presupuesto aprobado parcialmente - ${bref}`;
      
      await DB.add('incomes', {
        projectId: newProject.id,
        budgetId: budgetId,
        date: budget.date || today(),
        description: incomeDescription,
        amount: approvedAmount,
      });

      // Link budget to project
      await DB.update('budgets', budgetId, { 
        status: approvalType,
        items: budget.items,
        history,
        projectId: newProject.id
      });

      let invoiceCreated = null;
      if (budget.administration === 'USA') {
        try { invoiceCreated = await createInvoiceFromBudget(budgetId); } catch (e) { console.error('No se pudo crear factura automática:', e); }
      }

      if (invoiceCreated) {
        notify('Presupuesto aprobado y factura creada', 'success');
        navigate(`#/projects/${newProject.id}/invoices/${invoiceCreated.id}`);
        return;
      }

      notify('Presupuesto aprobado y proyecto creado', 'success');
      navigate('#/projects/' + newProject.id);
    } catch (err) {
      console.error('Error durante aprobación de presupuesto:', err);
      notify(err.message || 'No se pudo aprobar el presupuesto', 'error');
    }
  }
};

// Create invoice from an approved budget
window.createInvoiceFromBudget = async function(budgetId, options = {}) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) { notify('Presupuesto no encontrado', 'warning'); return null; }

  const invoiceAlreadyExists = (DB.getAll('invoices') || []).find(inv => inv.budgetId === budgetId);
  if (invoiceAlreadyExists) {
    return invoiceAlreadyExists;
  }

  const allowedAdministration = budget.administration || (budget.projectId ? DB.get('projects', budget.projectId)?.administration : '');
  if (!canGenerateInvoicesForProject(allowedAdministration)) {
    notify('Solo la administración United States puede generar facturas.', 'error');
    return null;
  }

  if (!['aprobado-total','aprobado-parcial'].includes(budget.status)) {
    if (!confirm('El presupuesto no está marcado como aprobado. Deseas crear igualmente la factura?')) return null;
  }

  // Ensure project exists (create if missing)
  let project = budget.projectId ? DB.get('projects', budget.projectId) : null;
  if (!project) {
    const projNum = await DB.nextNumber('projectCounter');
    project = await DB.add('projects', {
      name: budget.projectName || `Proyecto desde ${formatBudgetRef(budget.number ?? budget.budgetNumber ?? '')}`,
      client: budget.clientName,
      administration: 'USA',
      status: 'aprobado',
      date: budget.date || today(),
      budgetId: budgetId,
      budgetAmount: calcBudgetTotal(budget.items || [], 'USA', getBudgetIvaMode(budget)), // USA no tiene IVA/IGV
      number: projNum,
      // El tipo de cambio (uso interno, para normalizar gráficos a USD) ya no se copia de
      // acá — se carga directamente en el proyecto (pestaña "Información general").
    });
    await DB.update('budgets', budgetId, { projectId: project.id });
  }

  // Build invoice data from budget
  const items = (budget.items || []).map(it => ({ description: it.description, qty: it.qty, unitPrice: it.unitPrice }));
  const num = await DB.nextBudgetNumber(today());
  const inv = await DB.saveProjectInvoice(project.id, null, {
    budgetId: budgetId,
    projectId: project.id,
    clientName: budget.clientName,
    date: today(),
    dueDate: '',
    status: 'pendiente',
    notes: budget.notes || '',
    items,
    total: calcBudgetTotal(items),
    number: num,
    invoiceNumber: num,
    version: 1,
    generatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    history: []
  });

  notify('Factura creada desde presupuesto', 'success');
  if (options.navigate !== false) navigate(`#/projects/${project.id}/invoices/${inv.id}`);
  return inv;
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
window.saveBudgetForm = async function(projectId, budgetId) {
  try {
    const date = document.getElementById('b-date')?.value || today();
    const status = document.getElementById('b-status')?.value || 'borrador';
    const notes = document.getElementById('b-notes')?.value || '';
    const items = (window._liItems || []).filter(it => it.description || it.unitPrice);
    const administration = document.getElementById('b-admin')?.value || (budgetId ? DB.get('budgets', budgetId)?.administration : 'ARG') || 'ARG';
    const ivaMode = administration === 'PERU' ? 'con' : (administration === 'ARG' && document.getElementById('b-iva-con')?.checked ? 'con' : 'sin');
    const total = calcBudgetTotal(items, administration, ivaMode);

    // Datos del evento (opcionales): salen impresos en el PDF del presupuesto.
    const country = document.getElementById('b-country')?.value.trim() || '';
    const city = document.getElementById('b-city')?.value.trim() || '';
    const eventDate = document.getElementById('b-event-date')?.value || '';
    const projectType = document.getElementById('b-project-type')?.value.trim() || '';
    const assemblyDate = document.getElementById('b-assembly-date')?.value || '';
    const setupDate = document.getElementById('b-setup-date')?.value || '';
    const venueName = document.getElementById('b-venue-name')?.value.trim() || '';
    const venueAddress = document.getElementById('b-venue-address')?.value.trim() || '';

    if (!items.length) { notify('Agregá al menos un ítem', 'warning'); return; }

    notify('Guardando presupuesto...', 'info');

    let data = { date, status, notes, items, total, administration, country, city, eventDate, projectType, assemblyDate, setupDate, venueName, venueAddress };

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
      data.total = calcBudgetTotal(items, administration, ivaMode);
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

    // Si el presupuesto ya pertenece a un proyecto, los campos Nombre/Cliente/Administración
    // del formulario en realidad son los del PROYECTO (ver renderBudgetForm) — no se guardan
    // en el presupuesto, se sincronizan directamente con el proyecto vinculado.
    if (hasAssociatedProject && data.projectId) {
      const linkedProject = DB.get('projects', data.projectId);
      if (linkedProject) {
        const newProjectName = document.getElementById('b-project-name')?.value.trim() || linkedProject.name;
        const newClientName = document.getElementById('b-client')?.value.trim();
        const newAdministration = document.getElementById('b-admin')?.value || linkedProject.administration;
        const projectChanges = {};
        if (newProjectName && newProjectName !== linkedProject.name) projectChanges.name = newProjectName;
        if (newClientName && newClientName !== (linkedProject.client || '')) projectChanges.client = newClientName;
        if (newAdministration && newAdministration !== linkedProject.administration) projectChanges.administration = newAdministration;

        if (Object.keys(projectChanges).length) {
          if (projectChanges.administration) {
            const oldAdmLabel = ADMIN[linkedProject.administration]?.label || linkedProject.administration;
            const newAdmLabel = ADMIN[projectChanges.administration]?.label || projectChanges.administration;
            const confirmAdm = await Swal.fire({
              icon: 'warning',
              title: 'Cambiar la Administración del proyecto',
              html: `Vas a cambiar la administración de <strong>${esc(linkedProject.name)}</strong> de <strong>${esc(oldAdmLabel)}</strong> a <strong>${esc(newAdmLabel)}</strong>.<br><br>Esto afecta el cálculo de IVA/IGV, la moneda y los totales de <strong>todos</strong> los presupuestos e ingresos de este proyecto, no solo de este presupuesto.<br><br>¿Confirmás el cambio?`,
              showCancelButton: true,
              confirmButtonText: 'Sí, cambiar',
              cancelButtonText: 'Cancelar',
              confirmButtonColor: '#dc2626',
            });
            if (!confirmAdm.isConfirmed) {
              notify('Cambio cancelado. No se guardó ningún cambio.', 'info');
              return;
            }
          }
          await DB.update('projects', data.projectId, projectChanges);
        }
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
      // Capture IVA selection (ARG only UI shows it)
      const ivaCon = document.getElementById('b-iva-con');
      const ivaSin = document.getElementById('b-iva-sin');
      if (administration === 'PERU') data.iva = 'con';
      else if (ivaCon?.checked) data.iva = 'con';
      else if (ivaSin?.checked) data.iva = 'sin';
      else data.iva = undefined;
      await DB.update('budgets', budgetId, data);

      // Sincronizar el "Presupuesto Aprobado" congelado en el PROYECTO (project.budgetAmount).
      // Por qué: la Ganancia de Proyectos/Administración/Inicio ahora se calcula SIEMPRE desde
      // este valor guardado en el proyecto (ver getProjectFinancials en db.js/dbfirebase.js) y
      // ya NO se recalcula leyendo los items del presupuesto en cada pantalla — eso era lo que
      // generaba números distintos según la pantalla (y el lío con el IVA/IGV, que a veces se
      // aplicaba y a veces no). Si edita un presupuesto que YA está aprobado y vinculado a un
      // proyecto, recalculamos ese monto congelado con la MISMA fórmula que se usa al aprobar
      // (calcBudgetTotal/calcApprovedTotal + getBudgetIvaMode), para que quede al día.
      if (data.projectId && (data.status === 'aprobado-total' || data.status === 'aprobado-parcial')) {
        const confirmedAmount = data.status === 'aprobado-parcial'
          ? calcApprovedTotal(items, administration, ivaMode)
          : calcBudgetTotal(items, administration, ivaMode);
        const linkedProject = DB.get('projects', data.projectId);
        await DB.update('projects', data.projectId, {
          ...(linkedProject?.invoiceTotals ? {} : { budgetAmount: confirmedAmount }),
          date: data.date || today()
        });
      }

      notify('Presupuesto guardado');
      navigate('#/presupuestos');
    } else {
      const num = await callMaybeAsync(DB.nextBudgetNumber.bind(DB));
      const now = new Date();
      data.number = num;
      data.history = [{
        action: 'Presupuesto creado',
        date: today(),
        time: now.toLocaleTimeString('es-AR'),
        notes: 'Presupuesto inicial'
      }];
      // Capture IVA selection for newly created budgets
      const ivaConNew = document.getElementById('b-iva-con');
      const ivaSinNew = document.getElementById('b-iva-sin');
      if (administration === 'PERU') data.iva = 'con';
      else if (ivaConNew?.checked) data.iva = 'con';
      else if (ivaSinNew?.checked) data.iva = 'sin';
      else data.iva = undefined;
      const newBudget = await DB.add('budgets', data);
      notify('Presupuesto creado exitosamente');
      navigate('#/presupuestos/' + newBudget.id);
    }
  } catch (error) {
    console.error('Error guardando presupuesto:', error);
    notify(error.message || 'No se pudo guardar el presupuesto', 'error');
  }
};

window.approveBudget = async function(budgetId, projectId) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) return;

  // If a projectId was provided and exists, use it; otherwise create a new project from the budget
  let project = projectId ? DB.get('projects', projectId) : null;
  if (!project) {
    // don't create if budget already linked
    if (budget.projectId) {
      notify('Este presupuesto ya tiene un proyecto asociado', 'info');
      return;
    }
    const projNum = await DB.nextNumber('projectCounter');
    project = await DB.add('projects', {
      name: budget.projectName || `Proyecto desde ${formatBudgetRef(budget.number ?? budget.budgetNumber ?? '')}`,
      client: budget.clientName,
      administration: budget.administration,
      status: 'aprobado',
      date: budget.date || today(),
      budgetId: budgetId,
      budgetAmount: calcBudgetTotal(budget.items || [], budget.administration, getBudgetIvaMode(budget)),
      number: projNum,
      // El tipo de cambio (uso interno, para normalizar gráficos a USD) ya no se copia de
      // acá — se carga directamente en el proyecto (pestaña "Información general").
    });
  }

  // Update budget: set approved status, link project and push history
  const now = new Date();
  const history = budget.history || [];
  history.push({ action: 'Presupuesto aprobado y convertido a proyecto', date: today(), time: now.toLocaleTimeString('es-AR'), notes: '' });

  await DB.update('budgets', budgetId, { status: 'aprobado-total', projectId: project.id, history, items: budget.items });

  // Auto-income: only if not already recorded
  const existing = DB.getIncomesByProject(project.id).find(i => i.budgetId === budgetId);
  if (!existing) {
    await DB.add('incomes', {
      projectId: project.id,
      budgetId,
      date: budget.date || today(),
      description: `Presupuesto aprobado ${formatBudgetRef(budget.number ?? budget.budgetNumber ?? '')}`,
      amount: calcBudgetTotal(budget.items || [], budget.administration || 'ARG', getBudgetIvaMode(budget)),
    });
  }

  // Crear factura automáticamente a partir del presupuesto aprobado
  try { await createInvoiceFromBudget(budgetId); } catch (e) { console.error('No se pudo crear factura automática:', e); }

  // Update UI and navigate
  if (document.getElementById('b-status')) document.getElementById('b-status').value = 'aprobado-total';
  notify('Presupuesto aprobado y proyecto creado', 'success');
  renderBudgetForm(project.id, budgetId);
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

  const presupuestoAprobado = fin.budgetTotal;
  const gananciaFinanzas = fin.profit;
  return `
    <!-- Resumen financiero -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      ${[
        [project.invoiceTotals ? 'Facturación vigente' : 'Presupuesto Aprobado', presupuestoAprobado, 'text-gray-900'],
        ['Total Ingresos', fin.totalIncome, 'text-green-600'],
        ['Total Gastos', fin.totalExpense, 'text-red-600'],
        ['Ganancia', gananciaFinanzas, gananciaFinanzas >= 0 ? 'text-green-600' : 'text-red-600'],
      ].map(([l,v,c]) => {
        // For "Presupuesto Aprobado" mostrar nota de impuesto: el monto de arriba YA incluye
        // el IVA/IGV cuando corresponde (ver getBudgetIvaMode), esta nota es solo informativa.
        let extra = '';
        if (l === 'Presupuesto Aprobado') {
          if (project.administration === 'PERU') extra = '<div class="text-xs text-gray-400 mt-1">IGV incluido</div>';
          else if (project.administration === 'ARG') extra = '<div class="text-xs text-gray-400 mt-1">IVA incluido si aplica</div>';
        }
        // For Total Ingresos show bruto in parentheses for taxed administrations
        let valueHtml = `<p class="text-lg font-bold ${c}">${fmtCurrency(v, project.administration)}</p>`;
        if (l === 'Total Ingresos' && (project.administration === 'PERU' || project.administration === 'ARG')) {
          const bruto = fin.totalIncomeGross || v;
          valueHtml = `<p class="text-lg font-bold ${c}">${fmtCurrency(v, project.administration)} <span class="text-sm text-gray-500">(bruto ${fmtCurrency(bruto, project.administration)})</span></p>`;
        }
        return `
          <div class="kpi-card text-center">
            <p class="text-xs text-gray-400 mb-1">${l}${extra}</p>
            ${valueHtml}
          </div>
        `;
      }).join('')}
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
  }).then(async r => {
    if (!r.isConfirmed) return;
    try {
      if (expenseId) {
        await DB.update('expenses', expenseId, r.value);
        notify('Gasto actualizado');
      } else {
        await DB.add('expenses', r.value);
        notify('Gasto registrado');
      }
      renderProjectDetail(projectId, 'operations');
    } catch (error) {
      console.error('Error guardando gasto:', error);
      notify('No se pudo guardar el gasto', 'error');
    }
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
  }).then(async r => {
    if (!r.isConfirmed) return;
    try {
      if (incomeId) {
        await DB.update('incomes', incomeId, r.value);
        notify('Ingreso actualizado');
      } else {
        await DB.add('incomes', r.value);
        notify('Ingreso registrado');
      }
      renderProjectDetail(projectId, 'operations');
    } catch (error) {
      console.error('Error guardando ingreso:', error);
      notify('No se pudo guardar el ingreso', 'error');
    }
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

async function ensureInvoicesFromApprovedBudgets(project) {
  if (!project || project.administration !== 'USA') return;
  if (project.invoiceTotals) return;

  const allInvoices = DB.getAll('invoices') || [];
  const approvedBudgets = (DB.getBudgetsByProject(project.id) || []).filter(b =>
    ['aprobado-total', 'aprobado-parcial'].includes(b.status) &&
    !allInvoices.some(inv => inv.projectId === project.id && inv.budgetId === b.id)
  );

  for (const budget of approvedBudgets) {
    await createInvoiceFromBudget(budget.id, { navigate: false });
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTURACIÓN (tab — solo USA)
// ═══════════════════════════════════════════════════════════════
function renderTabInvoices(project) {
  const invoices = DB.getInvoicesByProject(project.id).sort((a,b) => (a.number||0) - (b.number||0));
  const rows = invoices.length ? invoices.map(inv => {
    const total = calcBudgetTotal(inv.items || []);
    return `<tr>
      <td class="font-medium">${esc(formatInvoiceRef(inv))}<small class="block text-gray-400">Versión ${inv.version || 1} · ${(inv.history || []).length} anteriores</small></td>
      <td>${badge(inv.status, INVOICE_STATUS)}</td>
      <td class="font-semibold text-gray-900">${fmtCurrency(total, project.administration)}</td>
      <td class="text-gray-400">${fmtDate(inv.date)}</td>
      <td>
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="navigate('#/projects/${project.id}/invoices/${inv.id}')">Ver / Editar</button>
          <button class="btn btn-secondary btn-sm btn-icon" onclick="previewInvoicePDF('${inv.id}')" title="Vista previa">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.036 12.322a1.012 1.012 0 010-.644C3.423 7.388 7.363 4 12 4s8.577 3.388 9.964 7.678a1.012 1.012 0 010 .644C20.577 16.612 16.637 20 12 20s-8.577-3.388-9.964-7.678z"/><circle cx="12" cy="12" r="3.5"/></svg>
          </button>
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
  if (!canGenerateInvoicesForProject(project)) {
    setBreadcrumb([{ label: 'Proyectos', route: '#/projects' }, { label: project.name }]);
    setActions(`<button class="btn btn-secondary btn-sm" onclick="navigate('#/projects')">← Volver</button>`);
    setContent(`
      <div class="max-w-xl mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center">
        <div class="text-4xl mb-3">🚫</div>
        <h2 class="text-xl font-bold text-gray-900 mb-2">Factura no disponible</h2>
        <p class="text-gray-600">Solo la administración United States puede generar facturas.</p>
      </div>
    `);
    return;
  }
  const inv = invoiceId ? DB.get('invoices', invoiceId) : null;
  if (invoiceId && (!inv || inv.projectId !== projectId)) {
    notify('Factura no encontrada en este proyecto.', 'error');
    return navigate(`#/projects/${projectId}/invoices`);
  }
  window._invoiceEditVersion = inv ? (inv.version || 1) : null;
  const num = inv?.number ?? inv?.invoiceNumber ?? '(nueva)';
  const cfg = DB.getConfig() || {};

  setBreadcrumb([
    { label: 'Proyectos', route: '#/projects' },
    { label: project.name, route: `#/projects/${projectId}/invoices` },
    { label: `Factura ${esc(formatInvoiceRef(inv || { number: num }))}` },
  ]);
  setActions(`
    <button class="btn btn-secondary btn-sm" onclick="navigate('#/projects/${projectId}/invoices')">← Volver</button>
    ${inv ? `<button class="btn btn-secondary btn-sm" onclick="previewInvoicePDF('${invoiceId}')">👁️ Vista previa</button>` : ''}
    ${inv ? `<button class="btn btn-secondary btn-sm" onclick="exportInvoicePDF('${invoiceId}')">📄 PDF</button>` : ''}
    <button class="btn btn-primary btn-sm" onclick="saveInvoiceForm('${projectId}','${invoiceId||''}')">💾 Guardar</button>
  `);

  const showUnit = false; // Unidad removed for all administrations
  const items = inv?.items || [{ description: '', qty: 1, unit: (showUnit? 'unit' : ''), unitPrice: 0 }];
  const statusOpts = Object.entries(INVOICE_STATUS).map(([k,v]) =>
    `<option value="${k}" ${(inv?.status||'borrador')===k?'selected':''}>${v.label}</option>`).join('');

  setContent(`
    <div class="max-w-4xl mx-auto space-y-6" id="invoice-form-wrap">
      <div class="bg-white border border-gray-200 rounded-2xl p-6">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="form-group mb-0">
            <label class="form-label">Bill To</label>
            <input id="inv-client" class="form-input" value="${esc(inv?.clientName ?? project.client ?? '')}" placeholder="Client name">
          </div>
          <div class="form-group mb-0">
            <label class="form-label">Invoice Date</label>
            <input id="inv-date" type="date" class="form-input" value="${inv?.date||today()}" required>
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
        <div class="p-3 border-b border-gray-100" style="background:#fff">
          <div id="inv-li-toolbar" style="display:flex;gap:8px;align-items:center">
            <button type="button" class="btn btn-sm btn-secondary" onmousedown="event.preventDefault()" onclick="execFormat('bold')" title="Negrita"><span style="font-weight:700">N</span></button>
            <button type="button" class="btn btn-sm btn-secondary" onmousedown="event.preventDefault()" onclick="execFormat('italic')" title="Cursiva"><span style="font-style:italic;font-weight:600">K</span></button>
            <select onchange="execFormat('fontSize', this.value)" class="form-select" style="max-width:120px">
              <option value="">Tamaño</option>
              <option value="2">Pequeño</option>
              <option value="3">Normal</option>
              <option value="5">Grande</option>
            </select>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="li-table w-full" id="inv-li-table">
            <thead>
              <tr>
                <th style="min-width:200px">Description</th>
                <th style="width:80px">Qty</th>
                ${showUnit ? '<th style="width:100px">Unidad</th>' : ''}
                <th style="width:120px">Unit Price</th>
                <th style="width:130px;text-align:right;padding-right:12px">Amount</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody id="inv-li-tbody">${items.map((it,i) => `
              <tr id="inv-li-row-${i}">
                <td><div class="li-desc" contenteditable="true" oninput="updateInvRow(${i})" onkeydown="invDescKeyDown(event, ${i})" onpaste="handleDescPaste(event)" onfocus="window._currentInvEditableIndex=${i}">${it.description ? it.description : ''}</div></td>
                <td><input type="number" min="0" value="${it.qty||1}" oninput="updateInvRow(${i})" id="inv-qty-${i}"></td>
                ${showUnit ? `<td><input type="text" value="${esc(it.unit||'')}" oninput="updateInvRow(${i})"></td>` : ''}
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
      <p class="text-sm text-gray-500">Podés editar Invoice Date. Al guardar, cada factura o versión recibe un número único con la fecha elegida y un correlativo diario, incluso si varias tienen la misma fecha. El monto del proyecto suma solo las facturas vigentes, no sus versiones.</p>
      ${inv ? renderInvoiceHistory(inv) : ''}
    </div>
  `);

  window._invItems = items.map(it => ({ ...it }));

  window.updateInvRow = (i) => {
    const rows = document.querySelectorAll('#inv-li-tbody tr');
    if (!rows[i]) return;
    const row = rows[i];
    const descEl = row.querySelector('.li-desc');
    const qtyEl = row.querySelector('#inv-qty-' + i) || row.querySelector('input[type="number"]');
    const upEl = row.querySelector('#inv-up-' + i) || row.querySelectorAll('input[type="number"]')?.[showUnit ? 2 : 1];

    const descHtml = descEl ? descEl.innerHTML : (window._invItems[i].description || '');
    const descText = descEl ? descEl.innerText.trim() : '';
    if (descEl && descText === '') descEl.innerHTML = '';
    if (descEl) descEl.classList.toggle('empty', descEl.innerText.trim() === '');

    if (showUnit) {
      const unitInput = row.querySelectorAll('input')[2];
      window._invItems[i] = { description: descHtml, qty: Number(qtyEl?.value)||0, unit: unitInput?.value || '', unitPrice: Number(upEl?.value)||0 };
    } else {
      window._invItems[i] = { description: descHtml, qty: Number(qtyEl?.value)||0, unitPrice: Number(upEl?.value)||0 };
    }
    document.getElementById(`inv-total-${i}`).textContent = fmtCurrency(window._invItems[i].qty * window._invItems[i].unitPrice, 'USA');
    document.getElementById('inv-total-grand').textContent = fmtCurrency(calcBudgetTotal(window._invItems), 'USA');
  };
  window.addInvRow = () => {
    const newItem = showUnit ? { description:'', qty:1, unit:'', unitPrice:0 } : { description:'', qty:1, unitPrice:0 };
    window._invItems.push(newItem);
    const i = window._invItems.length - 1;
    const tr = document.createElement('tr'); tr.id = `inv-li-row-${i}`;
    if (showUnit) {
      tr.innerHTML = `<td><div class="li-desc" contenteditable="true" oninput="updateInvRow(${i})" onkeydown="invDescKeyDown(event, ${i})" onpaste="handleDescPaste(event)" onfocus="window._currentInvEditableIndex=${i}"></div></td><td><input type="number" min="0" value="1" oninput="updateInvRow(${i})"></td><td><input type="text" oninput="updateInvRow(${i})"></td><td><input type="number" min="0" step="0.01" value="0" oninput="updateInvRow(${i})"></td><td style="text-align:right;padding-right:12px;font-weight:600;color:#374151" id="inv-total-${i}">${fmtCurrency(0,'USA')}</td><td><button onclick="removeInvRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td>`;
    } else {
      tr.innerHTML = `<td><div class="li-desc" contenteditable="true" oninput="updateInvRow(${i})" onkeydown="invDescKeyDown(event, ${i})" onpaste="handleDescPaste(event)" onfocus="window._currentInvEditableIndex=${i}"></div></td><td><input type="number" min="0" value="1" oninput="updateInvRow(${i})"></td><td><input type="number" min="0" step="0.01" value="0" oninput="updateInvRow(${i})"></td><td style="text-align:right;padding-right:12px;font-weight:600;color:#374151" id="inv-total-${i}">${fmtCurrency(0,'USA')}</td><td><button onclick="removeInvRow(${i})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td>`;
    }
    document.getElementById('inv-li-tbody').appendChild(tr);
    // Focus the new description editable and place caret at end
    setTimeout(() => {
      const el = document.querySelector(`#inv-li-row-${i} .li-desc`);
      if (el) { el.focus(); placeCaretAtEnd(el); }
    }, 0);
  };
  window.removeInvRow = (i) => {
    window._invItems.splice(i, 1);
    document.getElementById('inv-li-tbody').innerHTML = window._invItems.map((it,j) => {
      const description = `<td><div class="li-desc" data-placeholder="Description..." contenteditable="true" oninput="updateInvRow(${j})" onkeydown="invDescKeyDown(event, ${j})" onpaste="handleDescPaste(event)" onfocus="window._currentInvEditableIndex=${j}">${it.description || ''}</div></td>`;
      const unit = showUnit ? `<td><input type="text" value="${esc(it.unit||'')}" oninput="updateInvRow(${j})"></td>` : '';
      return `<tr id="inv-li-row-${j}">${description}<td><input id="inv-qty-${j}" type="number" min="0" value="${it.qty||1}" oninput="updateInvRow(${j})"></td>${unit}<td><input id="inv-up-${j}" type="number" min="0" step="0.01" value="${it.unitPrice||0}" oninput="updateInvRow(${j})"></td><td id="inv-total-${j}" style="text-align:right;padding-right:12px;font-weight:600">${fmtCurrency((it.qty||1)*(it.unitPrice||0),'USA')}</td><td><button onclick="removeInvRow(${j})" class="btn btn-danger btn-icon btn-sm" style="padding:4px"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></td></tr>`;
    }).join('');
    document.getElementById('inv-total-grand').textContent = fmtCurrency(calcBudgetTotal(window._invItems), 'USA');
  };
}

function invoiceSnapshot(inv) {
  return {
    version: inv.version || 1,
    number: inv.number ?? inv.invoiceNumber ?? '',
    clientName: inv.clientName || '',
    date: inv.date || '',
    dueDate: inv.dueDate || '',
    status: inv.status || 'borrador',
    notes: inv.notes || '',
    items: (inv.items || []).map(item => ({ ...item })),
    total: calcBudgetTotal(inv.items || []),
    generatedAt: inv.generatedAt || (parseToMs(inv.createdAt) ? new Date(parseToMs(inv.createdAt)).toISOString() : null)
  };
}

function renderInvoiceHistory(inv) {
  const versions = [...(inv.history || []), invoiceSnapshot(inv)].reverse();
  return `<div class="bg-white border border-gray-200 rounded-2xl p-6">
    <h3 class="font-semibold text-gray-900 mb-4">Historial de versiones</h3>
    ${versions.map(version => `<details class="border-b border-gray-100 py-3">
      <summary class="cursor-pointer text-sm font-medium">Versión ${version.version} · ${esc(formatInvoiceRef(version))} · ${fmtDate(version.date)} · ${fmtCurrency(version.total, 'USA')}${version.version === (inv.version || 1) ? ' (vigente)' : ''}</summary>
      <div class="space-y-3 mt-3 text-sm">
        <p>Cliente: ${esc(version.clientName)} · Vencimiento: ${fmtDate(version.dueDate)} · ${badge(version.status, INVOICE_STATUS)}</p>
        ${version.generatedAt ? `<p class="text-gray-400">Generada: ${esc(new Date(parseToMs(version.generatedAt)).toLocaleString('es-AR'))}</p>` : ''}
        <table class="data-table"><thead><tr><th>Descripción</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead>
          <tbody>${version.items.map(item => `<tr><td>${sanitizeItemDescriptionHtml(item.description || '')}</td><td>${Number(item.qty || 0)}</td><td>${fmtCurrency(item.unitPrice, 'USA')}</td><td>${fmtCurrency(Number(item.qty || 0) * Number(item.unitPrice || 0), 'USA')}</td></tr>`).join('')}</tbody>
        </table>
        <p style="white-space:pre-wrap">${esc(version.notes)}</p>
        <button class="btn btn-secondary btn-sm" onclick="previewInvoicePDF('${inv.id}',${version.version})">Vista previa</button>
        <button class="btn btn-secondary btn-sm" onclick="exportInvoicePDF('${inv.id}',${version.version})">PDF de esta versión</button>
      </div>
    </details>`).join('')}
  </div>`;
}

window.saveInvoiceForm = async function(projectId, invoiceId) {
  if (window._savingInvoice) return;
  const project = DB.get('projects', projectId);
  if (!project || !canGenerateInvoicesForProject(project)) {
    notify('Solo la administración United States puede generar facturas.', 'error');
    return;
  }
  const items = (window._invItems || []).filter(it => it.description || it.unitPrice);
  if (!items.length) { notify('Agregá al menos un ítem', 'warning'); return; }
  const data = {
    projectId,
    clientName: document.getElementById('inv-client')?.value.trim() || '',
    date: document.getElementById('inv-date')?.value || '',
    dueDate: document.getElementById('inv-due')?.value || '',
    status: document.getElementById('inv-status')?.value || 'borrador',
    notes: document.getElementById('inv-notes')?.value || '',
    items, total: calcBudgetTotal(items),
  };
  const expectedVersion = window._invoiceEditVersion;
  window._savingInvoice = true;
  try {
    const existing = invoiceId ? DB.get('invoices', invoiceId) : null;
    if (invoiceId && (!existing || existing.projectId !== projectId || (existing.version || 1) !== expectedVersion)) {
      throw new Error('La factura cambió o fue eliminada. Volvé a abrirla antes de guardar.');
    }
    const previous = existing ? { ...invoiceSnapshot(existing), projectId: existing.projectId } : null;
    if (previous && Object.keys(data).every(key => JSON.stringify(data[key]) === JSON.stringify(previous[key]))) {
      notify('No hay cambios para guardar.', 'info');
      return;
    }
    const num = await DB.nextBudgetNumber(data.date);
    const generatedAt = new Date().toISOString();
    await DB.saveProjectInvoice(projectId, invoiceId || null, {
      ...data,
      number: num,
      invoiceNumber: num,
      version: existing ? (existing.version || 1) + 1 : 1,
      generatedAt,
      ...(existing ? {} : { createdAt: generatedAt }),
      history: existing ? [...(existing.history || []), invoiceSnapshot(existing)] : []
    }, expectedVersion);
    notify(existing ? 'Nueva versión guardada y monto del proyecto actualizado' : 'Factura creada y monto del proyecto actualizado');
    navigate(`#/projects/${projectId}/invoices`);
  } catch (error) {
    console.error('Error guardando factura:', error);
    notify('No se pudo guardar la factura: ' + error.message, 'error');
  } finally {
    window._savingInvoice = false;
  }
};

async function deleteInvoice(id, projectId) {
  if (!await confirmDelete('esta factura y todo su historial de versiones')) return;
  try {
    const inv = DB.get('invoices', id);
    if (!inv) throw new Error('Factura no encontrada.');
    await DB.saveProjectInvoice(projectId, id, null, inv.version || 1);
    notify('Factura eliminada y monto del proyecto actualizado', 'info');
    renderProjectDetail(projectId, 'invoices');
  } catch (error) {
    console.error('Error eliminando factura:', error);
    notify('No se pudo eliminar la factura: ' + error.message, 'error');
  }
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

  const budgets = DB.getAll('budgets').filter(budget => recordYear(budget) === _reportingYear).sort((a, b) => {
    const ta = a && (a.date ? new Date(a.date).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0));
    const tb = b && (b.date ? new Date(b.date).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0));
    return (tb || 0) - (ta || 0);
  });
  const clients = [...new Set(budgets.map(b => b.clientName).filter(Boolean))].sort();

  const rows = budgets.map(b => {
    const total = calcBudgetTotal(b.items || [], b.administration, getBudgetIvaMode(b));
    const project = b.projectId ? DB.get('projects', b.projectId) : null;
    const refRaw = b.number ?? b.budgetNumber ?? b.invoiceNumber ?? '(sin número)';
    const ref = refRaw === '(sin número)' ? refRaw : formatBudgetRef(refRaw);
    
    return `<tr class="b-row cursor-pointer hover:bg-gray-50" data-status="${b.status}" data-admin="${b.administration||''}" data-client="${esc(b.clientName||'')}" onclick="navigate('#/presupuestos/${b.id}')">
      <td class="font-medium text-gray-900 nowrap-cell">${ref}</td>
      <td>
        <span class="font-semibold text-gray-900">${esc(b.projectName||'—')}</span>
        ${project ? `<span class="text-xs text-gray-400 ml-2">(Proyecto aprobado)</span>` : ''}
      </td>
      <td class="text-gray-600">${esc(b.clientName||'—')}</td>
      <td class="nowrap-cell">${b.administration ? adminBadge(b.administration) : '—'}</td>
      <td>${badge(b.status, BUDGET_STATUS)}</td>
      <td class="font-semibold text-gray-900 nowrap-cell">${fmtCurrency(total, b.administration||'ARG')}</td>
      <td class="text-gray-400">${fmtDate(b.date)}</td>
      <td onclick="event.stopPropagation()">
        <div class="flex gap-2">
          <button class="btn btn-secondary btn-sm" onclick="navigate('#/presupuestos/${b.id}')">Abrir</button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="deleteBudgetDirect('${b.id}')" title="Eliminar">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
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
  const ref = bnum ? formatBudgetRef(bnum) : '';
  if (!await confirmDelete(`Presupuesto ${ref}`)) return;
  // Remove any incomes linked to this budget
  try {
    (DB.getAll('incomes') || []).filter(i => i.budgetId === budgetId).forEach(i => DB.remove('incomes', i.id));
  } catch (e) { /* ignore if incomes not present */ }
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

  const invoices = DB.getAll('invoices')
    .filter(inv => recordYear(inv) === _reportingYear)
    .filter(inv => {
      const project = DB.get('projects', inv.projectId);
      return project && project.administration === 'USA';
    })
    .sort((a,b) => b.createdAt > a.createdAt ? 1:-1);
  const projects = DB.getAll('projects');
  const pMap = Object.fromEntries(projects.map(p => [p.id, p]));

  const rows = invoices.map(inv => {
    const p = pMap[inv.projectId] || {};
    const total = calcBudgetTotal(inv.items || []);
    return `<tr data-status="${esc(inv.status || '')}">
      <td class="font-medium text-gray-900">${esc(formatInvoiceRef(inv))}</td>
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
          <tbody id="inv-global-body">${rows.length ? rows.join('') : `<tr><td colspan="7"><div class="empty-state"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z"/></svg><p>Sin facturas en ${_reportingYear}</p><small>Las facturas de proyectos de EE.UU. aparecerán aquí</small></div></td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `);
}

function filterAllInvoices() {
  const q = (document.getElementById('q-inv')?.value||'').toLowerCase();
  const fst = document.getElementById('fi-status')?.value||'';
  document.querySelectorAll('#inv-global-body tr').forEach(r => {
    const show = (!q || r.textContent.toLowerCase().includes(q)) && (!fst || r.dataset.status === fst);
    r.style.display = show ? '' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════
// ADMINISTRACIONES
// ═══════════════════════════════════════════════════════════════
function renderAdministraciones() {
  setBreadcrumb([{ label: 'Administraciones' }]);
  setActions('');

  const usdByAdmin = {};

  const cards = Object.entries(ADMIN).map(([key, a]) => {
    const allProjects = DB.getAll('projects').filter(p => p.administration === key && recordYear(p) === _reportingYear);
    const pendingProjects = allProjects.filter(p => p.status === 'pendiente');
    const approvedProjects = allProjects.filter(p => p.status === 'aprobado');
    const totalProjects = allProjects.length;

    // Ganancia neta tomada de cada proyecto: Ingresos sin IVA/IGV - Gastos.
    let earnings = 0;
    let earningsUSD = 0;
    let approvedAmount = 0;
    allProjects.forEach(p => {
      try {
        const fin = DB.getProjectFinancials(p.id);
        earnings += Number(fin.profit || 0) || 0;
        earningsUSD += Number(fin.profitUSD || 0) || 0;
        if (p.status === 'aprobado') approvedAmount += Number(fin.budgetTotal || 0) || 0;
      } catch (e) { /* ignore */ }
    });
    usdByAdmin[key] = earningsUSD;

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
          <div class="admin-stat-box text-center p-3 rounded-xl w-full min-w-0 overflow-visible" style="background: #F9F9F9; border: 2px solid #E7E7E7; min-height: 96px; display:flex; flex-direction:column; justify-content:center; align-items:center; min-width: 0; width: 100%;">
            <p class="text-[8px] md:text-[9.5px] font-bold text-gray-500 uppercase mb-1 leading-none px-1 text-center" style="display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; letter-spacing:0.08em; white-space:normal; max-width:100%;">Pendientes</p>
            <p class="admin-stat-value text-2xl font-bold leading-none break-all text-center" style="color: ${a.flagColor}; display:block; text-align:center;">${pendingProjects.length}</p>
          </div>
          <div class="admin-stat-box text-center p-3 rounded-xl w-full min-w-0 overflow-visible" style="background: #F9F9F9; border: 2px solid #E7E7E7; min-height: 96px; display:flex; flex-direction:column; justify-content:center; align-items:center; min-width: 0; width: 100%;">
            <p class="text-[8px] md:text-[9.5px] font-bold text-gray-500 uppercase mb-1 leading-none px-1 text-center" style="display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; letter-spacing:0.08em; white-space:normal; max-width:100%;">Aprobados</p>
            <p class="admin-stat-value text-2xl font-bold leading-none break-all text-center" style="color: ${a.flagColor}; display:block; text-align:center;">${approvedProjects.length}</p>
            <p class="text-[9px] font-semibold text-gray-500 mt-1 text-center" style="white-space:normal; line-height:1.2;">${fmtCurrency(approvedAmount, key)}</p>
          </div>
          <div class="admin-stat-box text-center p-3 rounded-xl w-full min-w-0 overflow-visible" style="background: ${a.flagColor}15; border: 2px solid ${a.flagColor}; min-height: 96px; display:flex; flex-direction:column; justify-content:center; align-items:center; min-width: 0; width: 100%;">
            <p class="text-[8px] md:text-[9.5px] font-bold uppercase mb-1 leading-none px-1 text-center" style="color: ${a.flagColor}; display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.1; letter-spacing:0.08em; white-space:normal; max-width:100%;">Totales</p>
            <p class="admin-stat-value text-2xl font-bold leading-none break-all text-center" style="color: ${a.flagColor}; display:block; text-align:center;">${totalProjects}</p>
          </div>
        </div>
        
        <!-- Ganancias -->
        <div class="p-4 rounded-xl text-center mb-4 w-full min-w-0 overflow-hidden" style="background: ${a.flagColor}20; border: 2px solid ${a.flagColor}40">
          <p class="text-xs font-bold uppercase mb-2" style="color: ${a.flagColor}">Ganancias Totales</p>
          <p class="text-xl md:text-2xl font-bold leading-none break-all" style="color: ${a.flagColor}">${fmtCurrency(earnings, key)}</p>
          <div class="text-xs text-gray-500 mt-1">${usdEquivalentNote(key, earningsUSD)}</div>
        </div>

        <button onclick="filterProjectsByAdmin('${key}')" class="btn btn-secondary btn-sm w-full">
          Ver proyectos de ${a.label}
        </button>
      </div>
    `;
  }).join('');

  const hasUsdData = Object.values(usdByAdmin).some(v => v);

  // Distribución de ganancias por administración (gráfico de dona, normalizado a USD)
  const donutTotal = (Number(usdByAdmin.ARG) || 0) + (Number(usdByAdmin.PERU) || 0) + (Number(usdByAdmin.USA) || 0);
  const donutData = [
    { key: 'ARG',  label: 'Argentina', color: ADMIN.ARG.flagColor,  value: Number(usdByAdmin.ARG) || 0 },
    { key: 'PERU', label: 'Perú',      color: ADMIN.PERU.flagColor, value: Number(usdByAdmin.PERU) || 0 },
    { key: 'USA',  label: 'USA',       color: ADMIN.USA.flagColor,  value: Number(usdByAdmin.USA) || 0 },
  ];
  // El 100% de la dona se reparte SOLO entre las administraciones con ganancia real (value > 0).
  // Una administración en pérdida no puede ser "parte de una torta de ganancias", así que no
  // suma al 100% ni tiene gajo propio: se muestra aparte, con su monto en rojo y sin porcentaje.
  const donutGainsTotal = donutData.reduce((s, d) => s + (d.value > 0 ? d.value : 0), 0);
  const donutLegendHTML = donutData.map(d => {
    const isGain = d.value > 0;
    const pct = isGain && donutGainsTotal > 0 ? (d.value / donutGainsTotal * 100) : 0;
    return `
      <div class="mb-3 last:mb-0">
        <div class="flex items-center justify-between mb-1 gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${isGain ? d.color : '#dc2626'}"></span>
            <span class="text-sm font-medium text-gray-700 truncate">${d.label}</span>
          </div>
          <div class="text-right flex-shrink-0">
            <span class="text-sm font-semibold ${d.value < 0 ? 'text-red-600' : 'text-gray-900'}">${fmtCurrency(d.value, 'USA')}</span>
            ${isGain
              ? `<span class="text-xs text-gray-400 ml-1">${pct.toFixed(1)}%</span>`
              : (d.value < 0 ? `<span class="text-xs text-red-400 ml-1">pérdida</span>` : `<span class="text-xs text-gray-300 ml-1">sin datos</span>`)}
          </div>
        </div>
        ${isGain
          ? `<div class="w-full bg-gray-100 rounded-full h-1.5"><div class="h-1.5 rounded-full" style="width:${pct}%; background:${d.color}"></div></div>`
          : (d.value < 0 ? `<p class="text-[11px] text-gray-400 mt-0.5">No forma parte del 100% (no es ganancia)</p>` : '')}
      </div>
    `;
  }).join('');

  setContent(`
    <div class="max-w-5xl mx-auto">
      <p class="text-sm text-gray-600 mb-6">Resumen de actividad por administración. Cada administración maneja su propia moneda y contabilidad.</p>

      <div class="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
        <div class="flex items-start justify-between mb-1 gap-4">
          <div>
            <h3 class="font-semibold text-gray-900 mb-1">Distribución de ganancias por Administración</h3>
            <p class="text-xs text-gray-400">Ganancias de cada administración normalizadas a dólares (uso interno). El % se reparte solo entre las administraciones con ganancia real; una pérdida se muestra aparte, sin porcentaje.</p>
          </div>
          ${hasUsdData ? `
          <div class="text-right flex-shrink-0">
            <p class="text-xs text-gray-400">Total (neto)</p>
            <p class="text-lg font-bold text-gray-900">${fmtCurrency(donutTotal, 'USA')}</p>
          </div>` : ''}
        </div>
        ${hasUsdData ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center mt-4">
          <div class="relative flex items-center justify-center" style="min-height:200px;">
            <canvas id="admin-donut-chart" height="200"></canvas>
          </div>
          <div>
            ${donutLegendHTML}
          </div>
        </div>
        ` : '<p class="text-sm text-gray-400 text-center py-6">Todavía no hay proyectos con el tipo de cambio cargado. Cargalo en cada proyecto (sección "Tipo de cambio, uso interno") para ver la comparativa acá.</p>'}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">${cards}</div>
    </div>
  `);

  // La dona (gajos) solo incluye administraciones con ganancia real (value > 0) — una pérdida
  // no puede dibujarse como parte de un 100% de ganancias, así que no tiene gajo propio.
  const donutGainsData = donutData.filter(d => d.value > 0);

  if (hasUsdData) {
    requestAnimationFrame(() => {
      try {
        const canvas = document.getElementById('admin-donut-chart');
        if (!canvas || typeof window.Chart === 'undefined') return;
        if (!donutGainsData.length) {
          canvas.parentElement.innerHTML = '<div class="p-6 text-center text-sm text-gray-400">Ninguna administración tiene ganancia positiva todavía.</div>';
          return;
        }
        new Chart(canvas.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: donutGainsData.map(d => d.label),
            datasets: [{
              data: donutGainsData.map(d => d.value),
              backgroundColor: donutGainsData.map(d => d.color),
              borderColor: '#fff',
              borderWidth: 2,
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: true,
            cutout: '68%',
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (tctx) => {
                    const d = donutGainsData[tctx.dataIndex] || {};
                    const v = Number(d.value) || 0;
                    const pct = donutGainsTotal > 0 ? (v / donutGainsTotal * 100) : 0;
                    return ` ${d.label}: ${fmtCurrency(v, 'USA')} (${pct.toFixed(1)}%)`;
                  }
                }
              }
            }
          }
        });
      } catch (err) {
        console.error('Error creando gráfico comparativo de administraciones:', err);
      }
    });
  }
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
  const createdDate = parseToMs(project.createdAt) ? new Date(parseToMs(project.createdAt)).toLocaleDateString('es-AR') : '—';
  const invoices = canGenerateInvoicesForProject(project) ? DB.getInvoicesByProject(project.id) : [];
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
      ${canGenerateInvoicesForProject(project) ? `<p class="text-sm text-gray-500 mt-6">Las modificaciones de facturas se conservan como versiones. Solo las versiones vigentes se suman al monto del proyecto.</p>` : ''}
    </div>
    ${invoices.map(inv => `<div class="mt-4"><h4 class="font-semibold mb-2">Factura ${esc(formatInvoiceRef(inv))}</h4>${renderInvoiceHistory(inv)}</div>`).join('')}
  `;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
function renderSettings(section = 'company', extra) {
  setBreadcrumb([{ label: 'Configuración' }]);
  setActions('');

  const sections = [
    { key: 'company',    label: 'Empresa' },
    { key: 'terms',      label: 'Condiciones' },
    { key: 'security',   label: 'Seguridad' },
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
  if (section === 'terms') body = renderTermsSettings(extra);
  if (section === 'security') body = renderSecuritySettings();
  if (section === 'clients') body = renderClientSettings();
  if (section === 'categories') body = renderCategorySettings();
  if (section === 'demo') body = renderDemoDataSettings();

  setContent(`<div class="max-w-3xl mx-auto">${tabs}${body}</div>`);
  // Populate session fields if present
  try {
    const enabled = String(localStorage.getItem('aurea_enable_inactivity_watch')) === 'true';
    document.getElementById('session-enable-watch').checked = !!enabled;
    const timeoutMs = Number(localStorage.getItem('aurea_inactivity_timeout_ms')) || (15 * 60 * 1000);
    document.getElementById('session-timeout-min').value = Math.round(timeoutMs / 60000);
    const countdown = Number(localStorage.getItem('aurea_expire_countdown_s')) || 8;
    document.getElementById('session-countdown-s').value = countdown;
  } catch (e) { /* ignore if elements not present */ }
}

function renderSecuritySettings() {
  const currentUserEmail = Auth.getCurrentUser()?.email || 'demo@aurea.local';
  const modeText = window.isDemoMode
    ? 'Modo local: el cambio se guarda únicamente en este navegador.'
    : 'Modo producción: el cambio se guarda en Firebase Authentication.';

  return `
    <div class="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm" style="max-width: 980px; margin: 0 auto;">
      <div class="mb-6">
        <h3 class="text-2xl font-semibold text-gray-900 mb-2">Seguridad de la cuenta</h3>
        <p class="text-base text-gray-600">Cambiá la contraseña/PIN utilizado para ingresar a Aurea.</p>
      </div>

      <div class="rounded-2xl border border-gray-200 bg-gray-50 p-4 mb-8">
        <div class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">CUENTA</div>
        <div class="text-xl font-semibold text-gray-900">${esc(currentUserEmail)}</div>
        <div class="mt-2 text-sm text-gray-500">${modeText}</div>
      </div>

      <div class="space-y-5">
        <div>
          <label class="block text-base font-semibold text-gray-800 mb-2">Contraseña / PIN actual</label>
          <input id="security-current-pin" type="password" inputmode="numeric" maxlength="6" class="form-input" placeholder="••••" style="height: 46px; font-size: 16px;">
        </div>

        <div>
          <label class="block text-base font-semibold text-gray-800 mb-2">Nueva contraseña / PIN</label>
          <input id="security-new-pin" type="password" inputmode="numeric" maxlength="6" class="form-input" placeholder="4 a 6 dígitos" style="height: 46px; font-size: 16px;">
        </div>

        <div>
          <label class="block text-base font-semibold text-gray-800 mb-2">Confirmar nueva contraseña / PIN</label>
          <input id="security-confirm-pin" type="password" inputmode="numeric" maxlength="6" class="form-input" placeholder="Repetir nuevo PIN" style="height: 46px; font-size: 16px;">
        </div>

        <button class="btn btn-primary mt-4" style="padding: 14px 22px; border-radius: 12px; font-size: 18px; width: 100%; justify-content: center;" onclick="saveSecurityPin()">Cambiar contraseña</button>
      </div>

      <div class="mt-8 pt-5 border-t border-gray-200 text-sm text-gray-500 leading-relaxed">
        Aurea no guarda la contraseña en texto plano. En producción la credencial se administra mediante Firebase Authentication.
      </div>
  
      <div class="mt-8 pt-6 border-t border-gray-200">
        <h4 class="text-lg font-semibold text-gray-900 mb-3">Sesión e Inactividad</h4>
        <div class="space-y-4">
          <div>
            <label class="flex items-center gap-3">
              <input id="session-enable-watch" type="checkbox" style="width:18px;height:18px" />
              <span class="text-sm text-gray-700">Habilitar cierre automático por inactividad</span>
            </label>
          </div>

          <div class="grid grid-cols-2 gap-4 items-center">
            <div>
              <label class="block text-sm text-gray-600">Tiempo de inactividad (min)</label>
              <input id="session-timeout-min" type="number" min="1" class="form-input" style="width:120px;" />
            </div>
            <div>
              <label class="block text-sm text-gray-600">Contador modal (s)</label>
              <input id="session-countdown-s" type="number" min="3" class="form-input" style="width:120px;" />
            </div>
          </div>

          <div class="text-sm text-gray-500">Nota: Firebase además usa persistencia de sesión (SESSION), por lo que cerrar el navegador también cierra la sesión.</div>

          <div>
            <button class="btn btn-primary btn-sm" onclick="saveSessionSettings()">Guardar ajustes de sesión</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.saveSecurityPin = async function() {
  const current = document.getElementById('security-current-pin')?.value.trim() || '';
  const next = document.getElementById('security-new-pin')?.value.trim() || '';
  const confirm = document.getElementById('security-confirm-pin')?.value.trim() || '';

  if (!current) {
    notify('Ingresá tu PIN actual', 'warning');
    return;
  }

  if (!next || next.length < 4 || next.length > 6 || !/^\d+$/.test(next)) {
    notify('El nuevo PIN debe tener entre 4 y 6 dígitos numéricos', 'warning');
    return;
  }

  if (next !== confirm) {
    notify('Los PINs nuevos no coinciden', 'warning');
    return;
  }

  try {
    await Auth.changePIN(next, current);
    notify('PIN actualizado correctamente', 'success');
    document.getElementById('security-current-pin').value = '';
    document.getElementById('security-new-pin').value = '';
    document.getElementById('security-confirm-pin').value = '';
      // Refrescar la pestaña de seguridad para mostrar cambios inmediatos
      try { renderSettings('security'); } catch (e) { /* ignore */ }
  } catch (error) {
    notify(error.message || 'No se pudo cambiar el PIN', 'error');
  }
};

function renderCompanySettings() {
  const cfg = DB.getConfig();
  // Si la config aún no llegó (modo Firebase), mostrar estado de carga y reintentar al recibir datos
  if (cfg === null) {
    setContent(`
      <div class="max-w-3xl mx-auto">
        <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <div class="spinner mx-auto" style="width:36px;height:36px;border-width:3px;margin-bottom:12px"></div>
          <div class="text-gray-600">Cargando configuración de la empresa...</div>
        </div>
      </div>
    `);

    // Esperar evento de actualización desde DB
    const onUpdate = (ev) => {
      try {
        if (ev?.detail?.collection === 'config') {
          window.removeEventListener('db-updated', onUpdate);
          // Re-renderizar cuando ya tengamos la config
          renderCompanySettings();
        }
      } catch (e) { /* ignore */ }
    };
    window.addEventListener('db-updated', onUpdate);
    return;
  }

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
          ['company-address','Dirección', 'text', c.address || ''],
          ['company-address-2','Dirección (línea 2)','text', c.address2 || ''],
          ['company-city','Ciudad / Localidad','text',c.city||''],
          ['company-website','Sitio web (sale en el pie de página del PDF, no en el membrete)','text',c.website||''],
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
    address2: document.getElementById('company-address-2')?.value.trim() || '',
    city: document.getElementById('company-city')?.value.trim() || '',
    website: document.getElementById('company-website')?.value.trim() || '',
    taxId: document.getElementById('company-taxid')?.value.trim() || '',
  };
  DB.setConfig(cfg);
  notify('Configuración guardada');
  // Refrescar la pestaña de empresa para reflejar los cambios inmediatamente
  try { renderSettings('company'); } catch (e) { /* ignore */ }
};

// [SECCIÓN: CONDICIONES — CONFIGURACIÓN]
// ----------------------------------------------------------------------------
// Pantalla para editar, SIN TOCAR CÓDIGO, el texto de "Condiciones Generales"
// que se imprime en los presupuestos (PDF y vista previa) de cada
// administración (Argentina / Perú / USA) por separado. Se guarda en
// cfg.budgetTerms[administration] (texto simple, no HTML) y se usa desde
// buildBudgetHtmlFragment — ver "[SECCIÓN: CONDICIONES GENERALES]" y
// "[SECCIÓN: TEXTO LEGAL]" más abajo en este archivo para el detalle de
// prioridades (Notas del presupuesto > este texto > texto por defecto).
function renderTermsSettings(admin) {
  const cfg = DB.getConfig();
  if (cfg === null) {
    setContent(`
      <div class="max-w-3xl mx-auto">
        <div class="bg-white border border-gray-200 rounded-2xl p-6 text-center">
          <div class="spinner mx-auto" style="width:36px;height:36px;border-width:3px;margin-bottom:12px"></div>
          <div class="text-gray-600">Cargando configuración...</div>
        </div>
      </div>
    `);
    const onUpdate = (ev) => {
      try {
        if (ev?.detail?.collection === 'config') {
          window.removeEventListener('db-updated', onUpdate);
          renderSettings('terms', admin);
        }
      } catch (e) { /* ignore */ }
    };
    window.addEventListener('db-updated', onUpdate);
    return;
  }

  // Recuerda cuál administración se estaba editando (para no volver siempre a ARG
  // al guardar/refrescar la pantalla).
  const activeAdmin = (admin && ADMIN[admin]) ? admin : (window._termsSettingsAdmin && ADMIN[window._termsSettingsAdmin] ? window._termsSettingsAdmin : 'ARG');
  window._termsSettingsAdmin = activeAdmin;

  const savedText = (cfg.budgetTerms || {})[activeAdmin];
  const isCustom = savedText != null && savedText !== '';
  const textareaValue = isCustom ? savedText : (DEFAULT_BUDGET_TERMS_TEXT[activeAdmin] || '');
  const adm = ADMIN[activeAdmin];

  return `
    <div class="bg-white border border-gray-200 rounded-2xl p-6">
      <h3 class="font-semibold text-gray-900 mb-2">Condiciones Generales del Presupuesto</h3>
      <p class="text-sm text-gray-600 mb-5">
        Este texto se imprime en la sección "Condiciones Generales" de los presupuestos (PDF y
        vista previa) para la administración elegida abajo, siempre que ese presupuesto no tenga
        su propio texto manual cargado en "Notas". Cada administración tiene su propio texto —
        un cambio acá NO afecta a las otras dos.
      </p>

      <div class="flex flex-wrap gap-2 mb-5">
        ${['ARG','PERU','USA'].map(code => `
          <button class="btn ${activeAdmin===code ? 'btn-primary' : 'btn-secondary'}" onclick="renderSettings('terms','${code}')">${ADMIN[code].flag} ${ADMIN[code].label}</button>
        `).join('')}
      </div>

      ${isCustom ? '' : `<div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">Todavía no se guardó un texto propio para ${esc(adm.label)} — se está mostrando el texto por defecto de la app. Podés editarlo y guardarlo cuando quieras.</div>`}

      <div class="form-group">
        <label class="form-label">Texto (${esc(adm.label)})</label>
        <textarea id="terms-textarea" class="form-input" style="min-height:340px;font-family:inherit;line-height:1.6;resize:vertical" placeholder="Escribí acá las condiciones generales...">${esc(textareaValue)}</textarea>
        <p class="text-xs text-gray-500 mt-2">
          Separá cada párrafo con una línea en blanco (Enter dos veces). Para poner una parte en
          <strong>negrita</strong>, escribila entre doble asterisco, así: **texto en negrita**.
          No hace falta escribir HTML.
        </p>
      </div>

      <div class="flex flex-wrap gap-2 mt-4">
        <button class="btn btn-primary" onclick="saveBudgetTermsSettings('${activeAdmin}')">Guardar cambios</button>
        <button class="btn btn-secondary" onclick="resetBudgetTermsSettings('${activeAdmin}')">Restaurar texto por defecto</button>
      </div>
    </div>
  `;
}

window.saveBudgetTermsSettings = function(admin) {
  const cfg = DB.getConfig() || {};
  cfg.budgetTerms = cfg.budgetTerms || {};
  const text = document.getElementById('terms-textarea')?.value ?? '';
  cfg.budgetTerms[admin] = text;
  DB.setConfig(cfg);
  notify(`Condiciones guardadas para ${ADMIN[admin]?.label || admin}`);
  try { renderSettings('terms', admin); } catch (e) { /* ignore */ }
};

window.resetBudgetTermsSettings = function(admin) {
  const cfg = DB.getConfig() || {};
  if (cfg.budgetTerms) delete cfg.budgetTerms[admin];
  DB.setConfig(cfg);
  notify('Se restauró el texto por defecto');
  try { renderSettings('terms', admin); } catch (e) { /* ignore */ }
};

function renderClientSettings() {
  const clients = DB.getAll('clients');
  const rows = clients.length ? clients.map(c => `
    <tr>
      <td class="font-medium text-gray-900">${esc(c.name)}</td>
      <td class="text-gray-700">${esc(c.contactName || '—')}</td>
      <td class="text-gray-500">${esc(c.email || '—')}</td>
      <td class="text-gray-500">${esc(c.phone || '—')}</td>
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
  `).join('') : `<tr><td colspan="5" class="py-8 text-center text-gray-400">Sin clientes</td></tr>`;

  return `
    <div class="table-wrap">
      <div class="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 class="font-semibold text-gray-900">Clientes</h3>
        <button class="btn btn-primary btn-sm" onclick="showClientModal(null)">+ Nuevo cliente</button>
      </div>
      <table class="data-table">
        <thead><tr><th>Nombre</th><th>Contacto</th><th>Email</th><th>Teléfono</th><th style="width:80px"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

window.showClientModal = function(id, callback) {
  const c = id ? DB.get('clients', id) : null;
  Swal.fire({
    title: c ? 'Editar Cliente' : 'Nuevo Cliente',
    html: `
      <div style="text-align:left">
        <div class="form-group"><label class="form-label">Nombre *</label><input id="cl-name" class="form-input" value="${esc(c?.name||'')}"></div>
        <div class="form-group"><label class="form-label">Nombre de contacto</label><input id="cl-contact" class="form-input" value="${esc(c?.contactName||'')}"></div>
        <div class="form-group"><label class="form-label">Email</label><input id="cl-email" type="email" class="form-input" value="${esc(c?.email||'')}"></div>
        <div class="form-group"><label class="form-label">Teléfono</label><input id="cl-phone" class="form-input" value="${esc(c?.phone||'')}"></div>
        <div><label class="form-label">Dirección</label><input id="cl-address" class="form-input" value="${esc(c?.address||'')}"></div>
      </div>
    `,
    showCancelButton: true, confirmButtonText: 'Guardar', cancelButtonText: 'Cancelar', confirmButtonColor: '#f97316',
    preConfirm: () => {
      const name = document.getElementById('cl-name').value.trim();
      if (!name) { Swal.showValidationMessage('El nombre es obligatorio'); return false; }
      return {
        name,
        contactName: document.getElementById('cl-contact').value.trim(),
        email: document.getElementById('cl-email').value,
        phone: document.getElementById('cl-phone').value,
        address: document.getElementById('cl-address').value,
      };
    }
  }).then(async r => {
    if (!r.isConfirmed) return;
    let savedClient = null;
    try {
      if (id) {
        await DB.update('clients', id, r.value);
        savedClient = { ...r.value, id };
        notify('Cliente actualizado');
      } else {
        savedClient = await DB.add('clients', r.value);
        notify('Cliente creado');
      }
      if (typeof callback === 'function') callback(savedClient);
      renderSettings('clients');
    } catch (error) {
      console.error('Error guardando cliente:', error);
      notify('No se pudo guardar el cliente', 'error');
    }
  });
};

async function deleteClient(id, name) {
  if (!await confirmDelete(name)) return;
  try {
    await DB.remove('clients', id);
    notify('Cliente eliminado', 'info');
    renderSettings('clients');
  } catch (error) {
    console.error('Error eliminando cliente:', error);
    notify('No se pudo eliminar el cliente', 'error');
  }
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
                <span><strong>1 Proyecto aprobado</strong> con todas sus etapas</span>
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
          
          <div class="grid grid-cols-2 gap-3">
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
          <button id="clear-demo-btn" class="btn btn-secondary w-full" onclick="clearDemoDataWithConfirm()">Limpiar datos de ejemplo</button>
          </div>
          
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

window.clearDemoDataWithConfirm = async function() {
  if (!confirm('¿Querés eliminar los datos de ejemplo? Esto borra sólo los registros marcados como datos de muestra.')) return;
  const btn = document.getElementById('clear-demo-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Limpiando...';
  }
  try {
    if (typeof window.eliminarDatosDeMuestra === 'function') {
      await window.eliminarDatosDeMuestra();
      notify('Datos de ejemplo eliminados', 'success');
    } else {
      throw new Error('eliminarDatosDeMuestra no disponible');
    }
  } catch (e) {
    console.error('Error limpiando datos de muestra:', e);
    notify('Error limpiando datos de muestra: ' + (e.message || e), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Limpiar datos de ejemplo';
    }
    // Forzar re-render de settings
    renderSettings('demo');
  }
};

// ═══════════════════════════════════════════════════════════════
// PDF — PRESUPUESTO
// ═══════════════════════════════════════════════════════════════
// Build HTML fragment used for budget PDF and preview
// ============================================================================
// [SECCIÓN: TEXTO LEGAL] — CONDICIONES GENERALES POR DEFECTO — PRESUPUESTOS (PDF y vista previa)
// ----------------------------------------------------------------------------
// Este texto se imprime en la sección "Condiciones Generales" del presupuesto
// SOLO cuando el campo "Notas / Condiciones / Observaciones" del presupuesto
// está vacío. Si el usuario carga texto manual en ese campo desde la app,
// ese texto tiene prioridad y se muestra en su lugar (tal cual lo escribió).
//
// NOVEDAD: ya NO hace falta tocar código para cambiar este texto. Ahora se
// puede escribir/editar directamente desde la app, en Configuración →
// Condiciones, un cuadro de texto por administración (Argentina/Perú/USA).
// Ver más abajo "[SECCIÓN: CONDICIONES — CONFIGURACIÓN]" (renderTermsSettings)
// para esa pantalla, y "termsPlainTextToHtml" para cómo se convierte el texto
// escrito por el usuario en el HTML que se imprime en el PDF.
//
// Los strings DEFAULT_BUDGET_TERMS_TEXT de más abajo son el texto que se
// muestra la PRIMERA vez que alguien abre esa pantalla (antes de guardar
// nada propio) y lo que queda si se aprieta "Restaurar texto por defecto".
// Para cambiar el texto legal por defecto sin tocar código, ahora ALCANZA
// con editarlo desde Configuración → Condiciones. Si igual se lo quiere
// cambiar acá (por ejemplo, para actualizar el valor que trae la app antes
// de que nadie lo haya personalizado), es el mismo formato que se usa en la
// pantalla de Configuración: cada párrafo separado por una línea en blanco,
// y **doble asterisco** para negrita — NO hace falta escribir HTML.
// ============================================================================
function _budgetTermsParagraph(html, marginBottom) {
  // page-break-inside:avoid (+ break-inside, el equivalente moderno) evita que html2pdf
  // corte un párrafo de Condiciones Generales justo por la mitad entre dos páginas.
  return `<p style="font-size:13px;color:#475569;line-height:1.6;margin:0 0 ${marginBottom}px;page-break-inside:avoid;break-inside:avoid">${html}</p>`;
}

// termsPlainTextToHtml: convierte el texto simple que escribe el usuario (en
// Configuración → Condiciones, o en DEFAULT_BUDGET_TERMS_TEXT de abajo) en el
// HTML con estilo que se imprime en el PDF.
//   - Una línea en blanco separa un párrafo del siguiente.
//   - Un solo salto de línea DENTRO de un párrafo se respeta como <br> (salto
//     de línea simple, sin espacio extra) — útil para "Título" en una línea y
//     el detalle en la línea de abajo, como un mismo bloque.
//   - **texto entre doble asterisco** se muestra en negrita.
// El texto se escapa primero (esc) así que no se puede "inyectar" HTML desde
// este cuadro — solo se interpretan los ** de negrita, todo lo demás se
// muestra tal cual se escribió, ni siquiera si el usuario escribe <strong> a mano.
function termsPlainTextToHtml(text) {
  if (!text) return '';
  const paragraphs = String(text).replace(/\r\n/g, '\n').split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  return paragraphs.map((p, i) => {
    const escaped = esc(p).replace(/\n/g, '<br>');
    const bold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const marginBottom = i === paragraphs.length - 1 ? 0 : 12;
    return _budgetTermsParagraph(bold, marginBottom);
  }).join('');
}

// Texto por defecto en formato simple (el mismo que ve/edita el usuario en
// Configuración → Condiciones). Se convierte a HTML on-the-fly con
// termsPlainTextToHtml — no son strings de HTML como DEFAULT_BUDGET_TERMS de
// abajo (ese objeto se mantiene tal cual, como respaldo, por compatibilidad).
const DEFAULT_BUDGET_TERMS_TEXT = {
  ARG: `EL Presupuesto solo incluye los items detallados en el mismo. Los valores se encuentran expresados en pesos argentinos.

**Modalidad de Pago**
50% Adelantado - 50% antes del montaje

**Método de Pago**
Tranferencia Bancaria Vendor Internacional **AUREA TECHNICAL ART L.L.C**

**Personal:** Todo el personal y equipamiento cuenta con seguros y ART de trabajo. En caso de necesitar una cláusula de No Repetición por un monto puntual, deben enviarnos un correo con los datos del beneficiario y requisitos, para efectuar los seguros correspondientes. Los mismos estarán incluidos en el presupuesto. El presupuesto incluye viáticos, comidas, traslados del personal.

**Confidencialidad:** Esta Oferta, sus términos y toda información a la que el CLIENTE tenga acceso, será considerada información confidencial, y requerirá a sus empleados, contratistas y asesores que también cumplan con dicha obligación de confidencialidad, excepto que Aurea Technical Art la autorice expresamente y por escrito a revelar la información a terceros. La información confidencial no podrá ser transmitida a terceras empresas o personas, especialmente a empresas que compitan con Aurea Technical Art o tengan actividad similar.`,
  PERU: `EL Presupuesto solo incluye los items detallados en el mismo. Los valores se encuentran expresados en soles peruanos.

**Modalidad de Pago**
50% Adelantado - 50% antes del montaje

**Método de Pago**
Tranferencia Bancaria Vendor Internacional **AUREA TECHNICAL ART L.L.C**

**Personal:** Todo el personal y equipamiento cuenta con seguros y ART de trabajo. En caso de necesitar una cláusula de No Repetición por un monto puntual, deben enviarnos un correo con los datos del beneficiario y requisitos, para efectuar los seguros correspondientes. Los mismos estarán incluidos en el presupuesto. El presupuesto incluye viáticos, comidas, traslados del personal.

**Confidencialidad:** Esta Oferta, sus términos y toda información a la que el CLIENTE tenga acceso, será considerada información confidencial, y requerirá a sus empleados, contratistas y asesores que también cumplan con dicha obligación de confidencialidad, excepto que Aurea Technical Art la autorice expresamente y por escrito a revelar la información a terceros. La información confidencial no podrá ser transmitida a terceras empresas o personas, especialmente a empresas que compitan con Aurea Technical Art o tengan actividad similar.`,
  // Traducción de referencia — revisar/ajustar la redacción legal si hace falta.
  USA: `This Quote only includes the items detailed herein. Amounts are expressed in US dollars.

**Payment Terms**
50% Deposit - 50% before load-in

**Payment Method**
International Wire Transfer to **AUREA TECHNICAL ART L.L.C**

**Personnel:** All personnel and equipment are covered by insurance and workers' comp. If a Non-Compete clause is required for a specific amount, please send us the beneficiary's details and requirements so the corresponding insurance can be arranged. These will be included in the quote. The quote includes staff per diems, meals, and transportation.

**Confidentiality:** This Offer, its terms, and any information the CLIENT has access to will be considered confidential, and CLIENT shall require its employees, contractors, and advisors to comply with this confidentiality obligation as well, except where Aurea Technical Art expressly authorizes in writing the disclosure of information to third parties. Confidential information may not be shared with third-party companies or individuals, particularly companies that compete with Aurea Technical Art or have similar activities.`,
};

// DEFAULT_BUDGET_TERMS (HTML ya armado) — se mantiene como último respaldo,
// por si algún día termsPlainTextToHtml/DEFAULT_BUDGET_TERMS_TEXT no están
// disponibles. En el uso normal, buildBudgetHtmlFragment ahora arma este
// mismo texto a partir de DEFAULT_BUDGET_TERMS_TEXT (ver más abajo).
const DEFAULT_BUDGET_TERMS = {
  ARG: [
    _budgetTermsParagraph('EL Presupuesto solo incluye los items detallados en el mismo. Los valores se encuentran expresados en pesos argentinos.', 12),
    _budgetTermsParagraph('<strong>Modalidad de Pago</strong>', 4),
    _budgetTermsParagraph('50% Adelantado - 50% antes del montaje', 12),
    _budgetTermsParagraph('<strong>Método de Pago</strong>', 4),
    _budgetTermsParagraph('Tranferencia Bancaria Vendor Internacional <strong>AUREA TECHNICAL ART L.L.C</strong>', 12),
    _budgetTermsParagraph('<strong>Personal:</strong> Todo el personal y equipamiento cuenta con seguros y ART de trabajo. En caso de necesitar una cláusula de No Repetición por un monto puntual, deben enviarnos un correo con los datos del beneficiario y requisitos, para efectuar los seguros correspondientes. Los mismos estarán incluidos en el presupuesto. El presupuesto incluye viáticos, comidas, traslados del personal.', 12),
    _budgetTermsParagraph('<strong>Confidencialidad:</strong> Esta Oferta, sus términos y toda información a la que el CLIENTE tenga acceso, será considerada información confidencial, y requerirá a sus empleados, contratistas y asesores que también cumplan con dicha obligación de confidencialidad, excepto que Aurea Technical Art la autorice expresamente y por escrito a revelar la información a terceros. La información confidencial no podrá ser transmitida a terceras empresas o personas, especialmente a empresas que compitan con Aurea Technical Art o tengan actividad similar.', 0),
  ].join(''),
  PERU: [
    _budgetTermsParagraph('EL Presupuesto solo incluye los items detallados en el mismo. Los valores se encuentran expresados en soles peruanos.', 12),
    _budgetTermsParagraph('<strong>Modalidad de Pago</strong>', 4),
    _budgetTermsParagraph('50% Adelantado - 50% antes del montaje', 12),
    _budgetTermsParagraph('<strong>Método de Pago</strong>', 4),
    _budgetTermsParagraph('Tranferencia Bancaria Vendor Internacional <strong>AUREA TECHNICAL ART L.L.C</strong>', 12),
    _budgetTermsParagraph('<strong>Personal:</strong> Todo el personal y equipamiento cuenta con seguros y ART de trabajo. En caso de necesitar una cláusula de No Repetición por un monto puntual, deben enviarnos un correo con los datos del beneficiario y requisitos, para efectuar los seguros correspondientes. Los mismos estarán incluidos en el presupuesto. El presupuesto incluye viáticos, comidas, traslados del personal.', 12),
    _budgetTermsParagraph('<strong>Confidencialidad:</strong> Esta Oferta, sus términos y toda información a la que el CLIENTE tenga acceso, será considerada información confidencial, y requerirá a sus empleados, contratistas y asesores que también cumplan con dicha obligación de confidencialidad, excepto que Aurea Technical Art la autorice expresamente y por escrito a revelar la información a terceros. La información confidencial no podrá ser transmitida a terceras empresas o personas, especialmente a empresas que compitan con Aurea Technical Art o tengan actividad similar.', 0),
  ].join(''),
  // Traducción de referencia — revisar/ajustar la redacción legal si hace falta.
  USA: [
    _budgetTermsParagraph('This Quote only includes the items detailed herein. Amounts are expressed in US dollars.', 12),
    _budgetTermsParagraph('<strong>Payment Terms</strong>', 4),
    _budgetTermsParagraph('50% Deposit - 50% before load-in', 12),
    _budgetTermsParagraph('<strong>Payment Method</strong>', 4),
    _budgetTermsParagraph('International Wire Transfer to <strong>AUREA TECHNICAL ART L.L.C</strong>', 12),
    _budgetTermsParagraph('<strong>Personnel:</strong> All personnel and equipment are covered by insurance and workers\' comp. If a Non-Compete clause is required for a specific amount, please send us the beneficiary\'s details and requirements so the corresponding insurance can be arranged. These will be included in the quote. The quote includes staff per diems, meals, and transportation.', 12),
    _budgetTermsParagraph('<strong>Confidentiality:</strong> This Offer, its terms, and any information the CLIENT has access to will be considered confidential, and CLIENT shall require its employees, contractors, and advisors to comply with this confidentiality obligation as well, except where Aurea Technical Art expressly authorizes in writing the disclosure of information to third parties. Confidential information may not be shared with third-party companies or individuals, particularly companies that compete with Aurea Technical Art or have similar activities.', 0),
  ].join(''),
};

// ============================================================================
// [SECCIÓN: MAPA DEL PDF] — GUÍA RÁPIDA PARA EDITAR EL PDF/VISTA PREVIA DE PRESUPUESTOS
// ----------------------------------------------------------------------------
// Esta función (buildBudgetHtmlFragment) arma el HTML completo del presupuesto.
// Se usa TANTO para la vista previa en pantalla como para el PDF exportado —
// es la misma función en los dos casos, así que cualquier cambio acá se ve
// reflejado en ambos lugares automáticamente.
//
// Para encontrar rápido cada parte, buscar (Ctrl+F / Cmd+F) estas etiquetas,
// tal cual están escritas, en ESTE archivo:
//
//   [SECCIÓN: HEADER]              → nombre/datos de la empresa, logo, número
//                                     de presupuesto, fecha, badge de admin.
//   [SECCIÓN: DATOS DEL EVENTO]    → las 4 cajitas: País, Ciudad, Fecha del
//                                     Evento, Fecha de Montaje.
//   [SECCIÓN: CLIENTE/PROYECTO/VENUE] → las 3 cajitas debajo de "Datos del evento".
//   [SECCIÓN: TABLA DE ITEMS]      → la tabla con Descripción/Cant./P.Unitario/Total.
//   [SECCIÓN: TOTAL]               → el cuadro naranja con el total del presupuesto.
//   [SECCIÓN: IGV PERÚ]            → el cuadrito "+IGV" que sale solo en presupuestos de Perú.
//   [SECCIÓN: CONDICIONES GENERALES] → el texto legal (ver también DEFAULT_BUDGET_TERMS
//                                     más arriba en este archivo, ahí se edita el TEXTO).
//   [SECCIÓN: FOOTER]              → la línea con la URL del sitio web, al pie de la página.
//
// Tips generales para cambios de diseño:
//   - Los colores están escritos en hexadecimal dentro de style="...". El naranja
//     Aurea es #de591f, y aparece en la línea divisoria del header y en el cuadro
//     del TOTAL. Los colores por administración (ARG/PERU/USA) están en el objeto
//     ADMIN, al principio de este archivo (buscar "const ADMIN").
//   - Los espacios entre bloques se controlan con margin-bottom / margin-top /
//     padding en cada style="...". Un número más alto = más espacio.
//   - Después de cualquier cambio, correr `node --check app.js` en la terminal
//     para confirmar que no quedó ningún error de sintaxis antes de probarlo
//     en la app.
//
// TAMAÑOS DE LETRA (font-size) — dónde tocar cada uno:
//   Todos los tamaños de letra de este PDF están escritos en pixeles, como
//   font-size:12px dentro de cada style="...". Para achicar o agrandar un
//   texto puntual, buscar (Ctrl+F) el texto o la etiqueta de sección donde
//   está, y cambiar el número que acompaña a font-size. Como referencia,
//   estos son los tamaños actuales de cada parte (de más chico a más grande):
//     9px  → las etiquetas en mayúscula tipo "CLIENTE", "PAÍS", "CANT." (las
//            que están arriba de cada cajita, en gris).
//     10px → encabezados de la tabla de ítems (Descripción/Cant./P.Unitario/
//            Total) y el título "PRESUPUESTO"/"QUOTE" arriba del número.
//     11px → texto chico del footer y el "+IGV" en Perú.
//     12px → el valor dentro de las 4 cajitas de "Datos del Evento", los
//            datos de la empresa (dirección/teléfono/mail) y las celdas de
//            la tabla de ítems (cantidad, precio unitario, descripción).
//     13px → total de cada fila en la tabla de ítems, subtotal/IVA, fecha.
//     14px → Cliente / Proyecto / Venue (los valores, no las etiquetas).
//     20px → el nombre de la empresa (arriba a la izquierda).
//     26px → el número de presupuesto (arriba a la derecha del centro).
//     28px → el monto grande del cuadro naranja de TOTAL.
//   Regla práctica: para que un texto entre en un solo renglón, primero
//   probar bajando 1-2px el font-size antes de tocar otra cosa (padding,
//   ancho de columna, etc.) — normalmente alcanza con eso.
// ============================================================================
window.buildBudgetHtmlFragment = function(budget) {
  const project = budget.projectId ? DB.get('projects', budget.projectId) : null;
  const clientName = budget.clientName || project?.client || '—';
  const projectName = budget.projectName || project?.name || '—';
  const administration = budget.administration || project?.administration || 'ARG';
  const cfg = DB.getConfig() || {};
  const comp = cfg.company || {};
  const adm = ADMIN[administration] || ADMIN.ARG;
  // IMPORTANTE: el total del PDF/presupuesto que ve el cliente tiene que incluir el IVA/IGV
  // cuando corresponde (ver getBudgetIvaMode) — antes se calculaba sin pasar la administración
  // ni el modo de impuesto, así que siempre daba el subtotal sin impuesto.
  const budgetIvaModeForPdf = getBudgetIvaMode(budget);
  const pdfBreakdown = calcBudgetBreakdown(budget.items || [], administration, budgetIvaModeForPdf);
  const total = pdfBreakdown.total;
  const approvedTotal = calcApprovedTotal(budget.items || [], administration, budgetIvaModeForPdf);
  const isPartialApproval = budget.status === 'aprobado-parcial';
  const isEnglish = administration === 'USA';
  const t = {
    title: isEnglish ? 'QUOTE' : 'PRESUPUESTO',
    client: isEnglish ? 'Client' : 'Cliente',
    project: isEnglish ? 'Project' : 'Proyecto',
    venue: 'Venue',
    country: isEnglish ? 'Country' : 'País',
    city: isEnglish ? 'City' : 'Ciudad',
    eventDate: isEnglish ? 'Event Date' : 'Fecha del Evento',
    projectType: isEnglish ? 'Project Type' : 'Tipo de Proyecto',
    assemblyDate: isEnglish ? 'Assembly Date' : 'Fecha de Armado',
    setupDate: isEnglish ? 'Setup Date' : 'Fecha de Montaje',
    date: isEnglish ? 'Date' : 'Fecha',
    description: isEnglish ? 'Description' : 'Descripción',
    qty: isEnglish ? 'Qty' : 'Cant.',
    unitPrice: isEnglish ? 'Unit Price' : 'P. Unitario',
    total: isEnglish ? 'Total' : 'Total',
    totalBudget: isEnglish ? 'QUOTE TOTAL' : 'TOTAL PRESUPUESTO',
    approvedTotal: isEnglish ? 'APPROVED TOTAL' : 'TOTAL APROBADO',
    termsConditions: isEnglish ? 'TERMS & CONDITIONS' : 'CONDICIONES Y OBSERVACIONES',
    conditionsHeading: isEnglish ? 'General Terms' : 'Condiciones Generales',
    generatedOn: isEnglish ? 'Document generated on' : 'Documento generado el',
  };
  const displayNumber = formatBudgetRef(budget.number ?? budget.budgetNumber ?? '(sin número)');
  // eventBoxHTML: genera las cajitas grises de "Datos del Evento". "label" es el font-size:9px
  // de arriba (la etiqueta en mayúscula) y "value" es el font-size:12px de abajo
  // (el dato en sí). "padding:12px" es el aire interno de la cajita — si el
  // texto no entra en un renglón, primero probar bajando el font-size del value
  // (12px) 1px antes de achicar el padding.
  const eventBoxHTML = (label, value) => `
    <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:12px">
      <p style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:0 0 5px;white-space:nowrap">${label}</p>
      <p style="font-size:12px;font-weight:600;margin:0;color:#1e293b;white-space:nowrap">${value ? esc(value) : '—'}</p>
    </div>
  `;

  return `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:750px;margin:0 auto;padding:40px;color:#1e293b">
      <!-- [SECCIÓN: HEADER]
           Header alineado por ABAJO: izquierda = datos de la empresa (nombre en negro;
           orden Dirección, Dirección línea 2, Teléfono, Mail — la URL del sitio web NO va
           acá, va en el footer); centro = PRESUPUESTO + número, centrado respecto a TODA
           la página (no respecto a lo que sobra entre la izquierda y la derecha); derecha
           = logo, fecha y badge de administración apilados. El número queda a la misma
           altura que la última línea de la izquierda (Mail) y de la derecha (badge), como
           pidió el cliente.
           OJO: tanto el bloque central (PRESUPUESTO+número) como la columna derecha
           (logo+fecha+badge) van con position:absolute — NO son parte del flex de arriba.
           Esto NO es capricho, son dos problemas distintos que ya salieron en producción:
           1) El bloque central necesita centrarse respecto al ANCHO TOTAL de la página.
              Si fuera un simple hijo del flex (aunque tenga text-align:center) queda
              centrado solo en el espacio que le sobra entre la columna izquierda y la
              derecha — que casi nunca es simétrico — y el número sale corrido hacia un
              costado. Por eso va con left:50%;transform:translateX(-50%) sobre el wrapper
              con position:relative (que sí mide el ancho completo).
           2) La columna derecha con la imagen del logo: html2canvas (el motor que arma el
              PDF) mide mal la altura de una imagen dentro de un contenedor con
              align-items:end/flex-end/grid — el logo terminaba "flotando" fuera de lugar
              SOLO en el PDF exportado (en la vista previa del navegador se veía bien).
           Si en el futuro hay que volver a tocar esta zona: mantener ambos bloques en
           position:absolute, y probar siempre el PDF exportado (no solo la vista previa)
           antes de dar el cambio por bueno — los dos bugs de arriba NO se ven en la vista
           previa, solo en el PDF. -->
      <div style="position:relative;margin-bottom:24px">
        <div style="display:flex;gap:20px;border-bottom:3px solid #de591f;padding-bottom:14px">
          <div style="flex:1">
            <h1 style="font-size:20px;font-weight:800;color:#000;margin:0 0 4px">${esc(comp.name||'Aurea Technical Art')}</h1>
            ${comp.tagline ? `<p style="color:#374151;font-size:13px;margin:0 0 2px;font-weight:600">${esc(comp.tagline)}</p>` : ''}
            ${comp.address ? `<p style="color:#64748b;font-size:12px;margin:0 0 1px;line-height:1.3">${esc(comp.address)}</p>` : ''}
            ${comp.address2 ? `<p style="color:#64748b;font-size:12px;margin:0 0 1px;line-height:1.3">${esc(comp.address2)}</p>` : ''}
            ${comp.phone ? `<p style="color:#64748b;font-size:12px;margin:0 0 1px;line-height:1.3">${esc(comp.phone)}</p>` : ''}
            ${comp.email ? `<p style="color:#64748b;font-size:12px;margin:0;line-height:1.3">${esc(comp.email)}</p>` : ''}
          </div>
          <div style="flex:0 0 190px"></div>
        </div>
        <div style="position:absolute;left:50%;transform:translateX(-50%);bottom:14px;text-align:center;white-space:nowrap">
          <p style="font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin:0 0 2px">${t.title}</p>
          <p style="font-size:26px;font-weight:800;color:#000;margin:0">${displayNumber}</p>
        </div>
        <div style="position:absolute;right:0;bottom:14px;text-align:right;width:190px">
          ${comp.logo ? `<img src="${comp.logo}" style="width:190px;height:auto;max-height:78px;object-fit:contain;display:block;margin-left:auto" />` : ''}
          <p style="color:#64748b;font-size:13px;margin:8px 0 0">${t.date}: ${fmtDate(budget.date)}</p>
          <div style="margin-top:8px">
            <span style="display:inline-block;background:${adm.flagColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap">${adm.flag} ${adm.label} · ${adm.code}</span>
          </div>
        </div>
      </div>

      <!-- [SECCIÓN: DATOS DEL EVENTO] -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
        ${eventBoxHTML(t.country, budget.country)}
        ${eventBoxHTML(t.city, budget.city)}
        ${eventBoxHTML(t.projectType, budget.projectType)}
        ${eventBoxHTML(t.eventDate, budget.eventDate ? fmtDate(budget.eventDate) : '')}
        ${eventBoxHTML(t.assemblyDate, budget.assemblyDate ? fmtDate(budget.assemblyDate) : '')}
        ${eventBoxHTML(t.setupDate, budget.setupDate ? fmtDate(budget.setupDate) : '')}
      </div>

      <!-- [SECCIÓN: CLIENTE/PROYECTO/VENUE]
           Fuente del valor (Cliente/Proyecto/Venue) achicada de 18px a 14px — a 18px y en
           negrita, nombres largos (de cliente o proyecto) ocupaban 3-4 renglones y hacían
           el PDF innecesariamente largo. 14px sigue siendo bien legible y entra en menos
           líneas. Si hace falta ajustar de nuevo, tocar el font-size de estos 3 bloques. -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
        <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:14px">
          <p style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:0 0 6px">${t.client}</p>
          <p style="font-size:14px;font-weight:700;margin:0;line-height:1.3;color:#1e293b">${esc(clientName)}</p>
        </div>
        <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:14px">
          <p style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:0 0 6px">${t.project}</p>
          <p style="font-size:14px;font-weight:700;margin:0;line-height:1.3;color:#1e293b">${esc(projectName)}</p>
        </div>
        <div style="background:#F9F9F9;border:1px solid #E7E7E7;border-radius:10px;padding:14px">
          <p style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700;margin:0 0 6px">${t.venue}</p>
          <p style="font-size:14px;font-weight:700;margin:0;line-height:1.3;color:#1e293b">${budget.venueName ? esc(budget.venueName) : '—'}</p>
          ${budget.venueAddress ? `<p style="font-size:11px;color:#64748b;margin:3px 0 0">${esc(budget.venueAddress)}</p>` : ''}
        </div>
      </div>

      <!-- [SECCIÓN: TABLA DE ITEMS]
           <th> = encabezado (Descripción/Cant./P.Unitario/Total), font-size:10px.
           <td> = celdas de cada fila: la descripción del ítem es font-size:12px
           (line-height:1.35 controla el espacio entre renglones cuando la
           descripción tiene varias líneas, por ejemplo con <br>), cantidad y
           precio unitario son font-size:12px, y el total de la fila es
           font-size:13px en negrita (para que resalte un poco más).
           Los "width:45px / 95px / 105px" en Cant./P.Unitario/Total son el
           ANCHO de esas columnas — si un precio no entra en una línea, se
           puede agrandar ese width en vez de tocar el font-size (la columna
           de Descripción se achica automáticamente para compensar).
           padding:8px 12px = aire interno de cada celda (arriba/abajo 8px,
           izquierda/derecha 12px). -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #E7E7E7;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#F9F9F9">
            <th style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7">${t.description}</th>
            <th style="text-align:center;padding:10px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:45px">${t.qty}</th>
            <th style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:95px">${t.unitPrice}</th>
            <th style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;border-bottom:2px solid #E7E7E7;width:105px">${t.total}</th>
          </tr>
        </thead>
        <tbody>
          ${(budget.items||[]).map((it,i) => `
            <tr style="background:${i%2?'#EDEEF0':'#fff'};page-break-inside:avoid;break-inside:avoid">
              <td style="padding:8px 12px;font-size:12px;line-height:1.35;border-bottom:1px solid #E7E7E7;color:#334155">${sanitizeItemDescriptionHtml(it.description||'')}</td>
              <td style="text-align:center;padding:8px;font-size:12px;border-bottom:1px solid #E7E7E7;color:#334155;font-weight:600">${it.qty||0}</td>
              <td style="text-align:right;padding:8px 12px;font-size:12px;border-bottom:1px solid #E7E7E7;color:#334155">${fmtCurrency(it.unitPrice||0, administration)}</td>
              <td style="text-align:right;padding:8px 12px;font-size:13px;font-weight:700;border-bottom:1px solid #E7E7E7;color:#1e293b">${fmtCurrency((it.qty||0)*(it.unitPrice||0), administration)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <!-- [SECCIÓN: TOTAL]
           Subtotal/impuesto (cuando corresponde) van en font-size:13px, chico
           y gris, para no competir con el total. El cuadro naranja de abajo
           es el que más pesa visualmente: la etiqueta "TOTAL PRESUPUESTO" es
           font-size:11px y el monto en sí es font-size:28px en blanco y
           negrita — ese 28px es a propósito grande, es lo primero que el
           cliente tiene que ver. El cuadro amarillo de "TOTAL APROBADO" (solo
           aparece si el presupuesto está aprobado parcialmente) usa 20px. -->
      <div style="display:flex;justify-content:flex-end;margin-bottom:24px;page-break-inside:avoid;break-inside:avoid">
        <div style="min-width:280px">
          ${pdfBreakdown.iva > 0 ? `
            <div style="display:flex;justify-content:space-between;gap:16px;padding:2px 4px;font-size:13px;color:#64748b">
              <span>${isEnglish ? 'Subtotal' : 'Subtotal'}</span>
              <span>${fmtCurrency(pdfBreakdown.subtotal, administration)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;gap:16px;padding:2px 4px 10px;font-size:13px;color:#334155;font-weight:600">
              <span>${getTaxLabel(administration, true)}</span>
              <span>+ ${fmtCurrency(pdfBreakdown.iva, administration)}</span>
            </div>
          ` : ''}
          ${isPartialApproval ? `
            <div style="background:#FEF3C7;border:2px solid #FDE68A;border-radius:10px;padding:14px 20px;text-align:right;margin-bottom:10px">
              <p style="color:#92400E;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px;font-weight:700">${t.approvedTotal}</p>
              <p style="color:#92400E;font-size:20px;font-weight:800;margin:0">${fmtCurrency(approvedTotal, administration)}</p>
            </div>
          ` : ''}
          <div style="background:#de591f;border-radius:12px;padding:18px 24px;text-align:right">
            <p style="color:rgba(255,255,255,.8);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 6px;font-weight:700">${t.totalBudget}</p>
            <p style="color:#fff;font-size:28px;font-weight:800;margin:0">${fmtCurrency(total, administration)}</p>
          </div>
        </div>
      </div>

      ${administration === 'PERU' ? `
        <!-- [SECCIÓN: IGV PERÚ] — solo se muestra cuando administration === 'PERU' -->
        <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
          <div style="border:1px solid #E7E7E7;padding:10px 14px;border-radius:8px;background:#fff;width:220px;text-align:center">
            <div style="font-size:12px;color:#64748b;font-weight:700;margin-bottom:6px">IGV</div>
            <div style="font-size:14px;color:#374151;font-weight:700">+ IGV</div>
          </div>
        </div>
      ` : ''}

      <!-- [SECCIÓN: CONDICIONES GENERALES]
           Orden de prioridad (el primero que exista es el que se usa):
             1) Texto manual cargado en "Notas" del presupuesto (escapado, tal
                cual lo escribió el usuario en ESE presupuesto puntual).
             2) Texto propio guardado en Configuración → Condiciones para esta
                administración (cfg.budgetTerms[administration]) — se edita
                desde la app, sin tocar código (ver renderTermsSettings).
             3) Texto por defecto de la app (DEFAULT_BUDGET_TERMS_TEXT) — buscar
                "[SECCIÓN: TEXTO LEGAL]" más arriba en este archivo. -->
      ${(() => {
        const manualNotes = budget.notes ? `<p style="font-size:13px;color:#475569;white-space:pre-wrap;margin:0;line-height:1.6;page-break-inside:avoid;break-inside:avoid">${esc(budget.notes)}</p>` : '';
        const customTermsText = (cfg.budgetTerms || {})[administration];
        const customTermsHtml = customTermsText ? termsPlainTextToHtml(customTermsText) : '';
        const defaultTermsHtml = DEFAULT_BUDGET_TERMS_TEXT[administration] ? termsPlainTextToHtml(DEFAULT_BUDGET_TERMS_TEXT[administration]) : (DEFAULT_BUDGET_TERMS[administration] || '');
        const conditionsHtml = manualNotes || customTermsHtml || defaultTermsHtml;
        if (!conditionsHtml) return '';
        // page-break-inside:avoid (+ el equivalente moderno break-inside) le pide a html2pdf
        // que, si este bloque no entra en lo que queda de la página actual, lo empuje entero
        // a la página siguiente en vez de cortarlo por la mitad. Cada párrafo individual
        // (ver _budgetTermsParagraph) tiene el mismo estilo, como respaldo por si el bloque
        // completo es más alto que una página entera y de todos modos hay que partirlo.
        return `
        <div style="margin-bottom:24px;page-break-inside:avoid;break-inside:avoid">
          <p style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 12px">${t.conditionsHeading}</p>
          ${conditionsHtml}
        </div>`;
      })()}

      <!-- [SECCIÓN: FOOTER]
           Solo la URL del sitio web — pedido del cliente, sin nombre de empresa,
           sin Tax ID, sin fecha de generación. Toma comp.website (el campo nuevo,
           "Sitio web" en Configuración → Empresa); si todavía está vacío porque no se
           migró el texto desde el campo "Ciudad / Localidad" (donde antes se guardaba
           la URL como truco), usa comp.city como respaldo para que no quede en blanco. -->
      ${(() => {
        const websiteUrl = comp.website || comp.city || '';
        if (!websiteUrl) return '';
        return `
      <div style="text-align:center;font-size:11px;color:#cbd5e1;margin-top:40px;border-top:1px solid #E7E7E7;padding-top:20px">
        <p style="margin:0">${esc(websiteUrl)}</p>
      </div>
      `;
      })()}
    </div>
  `;
};

window.exportBudgetPDF = function(budgetId) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) { notify('Presupuesto no encontrado', 'error'); return; }

  const html = window.buildBudgetHtmlFragment(budget);

  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);

  const project = budget.projectId ? DB.get('projects', budget.projectId) : null;
  const administration = budget.administration || project?.administration || 'ARG';
  const isEnglish = administration === 'USA';
  const clientName = budget.clientName || project?.client || '—';
  const docType = isEnglish ? 'Quote' : 'Presupuesto';
  const displayNumber = formatBudgetRef(budget.number ?? budget.budgetNumber ?? '');
  const fileName = `${docType}_${String(displayNumber).replace(/[#\s]/g,'_')}_${esc(clientName).replace(/\s+/g,'_')}.pdf`;
  
  // Ensure html2pdf is available and handle errors gracefully
  if (typeof html2pdf !== 'function') {
    document.body.removeChild(el);
    notify('No se encontró la librería html2pdf. Revisa que esté cargada.', 'error');
    return;
  }

  try {
    html2pdf().set({
      margin: 10,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      // scrollX/scrollY: 0 — evita un bug conocido de html2canvas: si la página de la app
      // está scrolleada hacia abajo en el momento de exportar (por ejemplo, el usuario venía
      // bajando por un presupuesto largo y ahí hizo clic en "Exportar PDF"), html2canvas puede
      // capturar el contenido desplazado/mal alineado — el PDF sale con una página casi en
      // blanco al principio y el total (u otro contenido) cortado, aunque en la vista previa
      // se vea perfecto. Forzar scrollX/scrollY a 0 hace que la captura sea siempre la misma
      // sin importar cuánto haya scrolleado el usuario.
      html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // 'css' hace que html2pdf respete los page-break-inside:avoid del HTML (Condiciones
      // Generales, cada párrafo, la tabla de ítems, el total) para no cortarlos a la mitad
      // entre dos páginas. 'legacy' es el resto del comportamiento de paginación por defecto.
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(el).save().then(() => {
      document.body.removeChild(el);
      notify('PDF generado correctamente');
    }).catch(err => {
      document.body.removeChild(el);
      console.error('Error generando PDF (budget):', err);
      notify('Error generando PDF: ' + (err && err.message ? err.message : String(err)), 'error');
    });
  } catch (err) {
    document.body.removeChild(el);
    console.error('Error iniciando html2pdf (budget):', err);
    notify('Error generando PDF: ' + (err && err.message ? err.message : String(err)), 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// PDF — FACTURA / INVOICE
// ═══════════════════════════════════════════════════════════════
// OJO: esta es una función APARTE de buildBudgetHtmlFragment (la de los
// presupuestos, más arriba) — tiene su propio HTML y sus propios font-size,
// así que los tamaños de letra NO son los mismos ni comparten los mismos
// números. Hoy por hoy solo se usa para la administración USA (ver
// ADMIN.USA.invoice). Algunos tamaños de referencia acá abajo: 12-13px para
// datos generales, celdas de la tabla y "Bill To"/"Project"; 16px para el
// nombre del cliente/proyecto; 20px para el título Factura/Invoice; 24px
// para el número de factura; 26px para el monto total en el cuadro naranja.
function getInvoiceVersion(invoiceId, version) {
  const current = DB.get('invoices', invoiceId);
  if (!current) return null;
  if (version == null || version === (current.version || 1)) return current;
  const historical = (current.history || []).find(entry => entry.version === version);
  return historical ? { ...historical, projectId: current.projectId, id: current.id } : null;
}

function buildInvoiceHtmlFragment(invoiceId, version) {
  const inv = getInvoiceVersion(invoiceId, version);
  if (!inv) return '';

  const project = DB.get('projects', inv.projectId);
  if (!project || !canGenerateInvoicesForProject(project)) {
    return '';
  }

  const cfg = DB.getConfig() || {};
  const comp = cfg.company || {};
  const total = calcBudgetTotal(inv.items || []);
  const pdfBrandColor = '#de591f';
  const adm = ADMIN.USA;
  const t = {
    title: 'INVOICE',
    date: 'Date',
    due: 'Due',
    billTo: 'Bill To',
    project: 'Project',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit Price',
    amount: 'Amount',
    totalDue: 'TOTAL DUE',
    notes: 'Notes / Payment Terms',
    generated: 'Generated',
  };

  const invRaw = inv.number ?? inv.invoiceNumber ?? '';
  let invDisplay;
  if (typeof invRaw === 'number') {
    const s = String(invRaw);
    if (/^\d{9}$/.test(s)) invDisplay = formatBudgetRef(s);
    else invDisplay = String(invRaw).padStart(3,'0');
  } else {
    const s = String(invRaw || '');
    invDisplay = formatBudgetRef(s) || '(sin número)';
  }

  return `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:720px;margin:0 auto;padding:40px;color:#1e293b">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${pdfBrandColor};padding-bottom:20px;margin-bottom:30px">
        <div style="flex:1">
          ${comp.logo ? `<img src="${comp.logo}" style="max-width:150px;max-height:80px;margin-bottom:12px;object-fit:contain" />` : ''}
          <h1 style="font-size:28px;font-weight:800;color:${pdfBrandColor};margin:0">${esc(comp.name||'Aurea Technical Art')}</h1>
          ${comp.tagline ? `<p style="color:#374151;font-size:13px;margin:6px 0;font-weight:600">${esc(comp.tagline)}</p>` : ''}
          ${comp.address ? `<p style="color:#64748b;font-size:12px;margin:6px 0 2px">${esc(comp.address)}</p>` : ''}
          ${comp.address2 ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.address2)}</p>` : ''}
          ${comp.city ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.city)}</p>` : ''}
          ${comp.email ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.email)}</p>` : ''}
          ${comp.phone ? `<p style="color:#64748b;font-size:12px;margin:2px 0">${esc(comp.phone)}</p>` : ''}
          ${comp.taxId ? `<p style="color:#64748b;font-size:12px;margin:2px 0">Tax ID: ${esc(comp.taxId)}</p>` : ''}
        </div>
        <div style="text-align:right">
          <h2 style="font-size:20px;font-weight:700;color:#334155;margin:0">${t.title}</h2>
          <p style="font-size:24px;font-weight:800;color:${pdfBrandColor};margin:4px 0">${esc(invDisplay)}</p>
          <p style="color:#64748b;font-size:13px">${t.date}: ${fmtDate(inv.date)}</p>
          ${inv.dueDate ? `<p style="color:#64748b;font-size:13px">${t.due}: ${fmtDate(inv.dueDate)}</p>` : ''}
          <p style="font-size:12px;color:#64748b;margin:6px 0 0;font-weight:600">
            <span style="display:inline-block;background:${pdfBrandColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;margin-right:6px">${adm.flag}</span>
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
          <tr style="background:#fff7ed">
            <th style="text-align:left;padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:${pdfBrandColor};border-bottom:2px solid #fed7aa">${t.description}</th>
            <th style="text-align:center;width:60px;padding:10px;font-size:11px;text-transform:uppercase;color:${pdfBrandColor};border-bottom:2px solid #fed7aa">${t.qty}</th>
            <th style="text-align:right;width:120px;padding:10px 14px;font-size:11px;text-transform:uppercase;color:${pdfBrandColor};border-bottom:2px solid #fed7aa">${t.unitPrice}</th>
            <th style="text-align:right;width:130px;padding:10px 14px;font-size:11px;text-transform:uppercase;color:${pdfBrandColor};border-bottom:2px solid #fed7aa">${t.amount}</th>
          </tr>
        </thead>
        <tbody>
          ${(inv.items||[]).map((it,i) => `
            <tr style="background:${i%2?'#f8fafc':'#fff'}">
              <td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${sanitizeItemDescriptionHtml(it.description||'')}</td>
              <td style="text-align:center;padding:10px;font-size:13px;border-bottom:1px solid #f1f5f9">${it.qty||0}</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;border-bottom:1px solid #f1f5f9">${fmtCurrency(it.unitPrice||0,project?.administration||'USA')}</td>
              <td style="text-align:right;padding:10px 14px;font-size:13px;font-weight:600;border-bottom:1px solid #f1f5f9">${fmtCurrency((it.qty||0)*(it.unitPrice||0),project?.administration||'USA')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="display:flex;justify-content:flex-end;margin-bottom:24px">
        <div style="background:${pdfBrandColor};border-radius:12px;padding:16px 24px;text-align:right;min-width:200px">
          <p style="color:rgba(255,255,255,.7);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px">${t.totalDue}</p>
          <p style="color:#fff;font-size:26px;font-weight:800;margin:0">${fmtCurrency(total,project?.administration||'USA')}</p>
        </div>
      </div>

      ${inv.notes ? `<div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:24px"><p style="font-size:11px;text-transform:uppercase;font-weight:700;color:#94a3b8;margin:0 0 6px">${t.notes}</p><p style="font-size:13px;color:#374151;white-space:pre-wrap;margin:0">${esc(inv.notes)}</p></div>` : ''}

      <p style="text-align:center;font-size:11px;color:#cbd5e1;margin-top:30px;border-top:1px solid #f1f5f9;padding-top:16px">
        ${esc(comp.name||'Aurea')} · ${t.generated} ${fmtDate(inv.date)}
      </p>
    </div>
  `;
}

window.previewInvoicePDF = function(invoiceId, version) {
  const inv = getInvoiceVersion(invoiceId, version);
  if (!inv) { notify('Factura o versión no encontrada', 'error'); return; }
  const project = DB.get('projects', inv.projectId);
  if (!project || !canGenerateInvoicesForProject(project)) {
    notify('Solo la administración United States puede generar facturas.', 'error');
    return;
  }

  const fragment = buildInvoiceHtmlFragment(invoiceId, version);
  if (!fragment) {
    notify('No se pudo armar la vista previa de la factura.', 'error');
    return;
  }

  const invRaw = inv.number ?? inv.invoiceNumber ?? '(sin número)';
  const displayNumber = formatBudgetRef(String(invRaw)) || '(sin número)';
  const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa — ${esc(displayNumber)}</title></head><body><div style="margin-bottom:12px"><button onclick="(function(){ if(window.opener && typeof window.opener.exportInvoicePDF==='function'){ window.opener.exportInvoicePDF('${invoiceId}',${inv.version || 1}); } else { alert('No se puede exportar desde aquí'); } })()" style="padding:8px 12px;margin-right:8px">Exportar PDF</button><button onclick="window.print()" style="padding:8px 12px">Imprimir</button></div>${fragment}</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=800,scrollbars=yes');
  if (!w) { notify('El navegador bloqueó la ventana emergente. Permití popups para previsualizar.', 'warning'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
};

window.exportInvoicePDF = function(invoiceId, version) {
  const inv = getInvoiceVersion(invoiceId, version);
  if (!inv) { notify('Factura o versión no encontrada', 'error'); return; }
  const project = DB.get('projects', inv.projectId);
  if (!project || !canGenerateInvoicesForProject(project)) {
    notify('Solo la administración United States puede generar facturas.', 'error');
    return;
  }

  const html = buildInvoiceHtmlFragment(invoiceId, version);
  if (!html) {
    notify('No se pudo generar la factura.', 'error');
    return;
  }

  const invRaw = inv.number ?? inv.invoiceNumber ?? '';
  let invDisplay;
  if (typeof invRaw === 'number') {
    const s = String(invRaw);
    if (/^\d{9}$/.test(s)) invDisplay = formatBudgetRef(s);
    else invDisplay = String(invRaw).padStart(3,'0');
  } else {
    const s = String(invRaw || '');
    invDisplay = formatBudgetRef(s) || '(sin número)';
  }

  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);

  const docType = 'Invoice';
  const fileName = `${docType}_${String(invDisplay).replace(/[#\s]/g,'_')}.pdf`;

  if (typeof html2pdf !== 'function') {
    document.body.removeChild(el);
    notify('No se encontró la librería html2pdf. Revisa que esté cargada.', 'error');
    return;
  }

  try {
    html2pdf().set({
      margin: 10,
      filename: fileName,
      image: { type: 'jpeg', quality: 0.98 },
      // scrollX/scrollY: 0 — evita un bug conocido de html2canvas: si la página de la app
      // está scrolleada hacia abajo en el momento de exportar (por ejemplo, el usuario venía
      // bajando por un presupuesto largo y ahí hizo clic en "Exportar PDF"), html2canvas puede
      // capturar el contenido desplazado/mal alineado — el PDF sale con una página casi en
      // blanco al principio y el total (u otro contenido) cortado, aunque en la vista previa
      // se vea perfecto. Forzar scrollX/scrollY a 0 hace que la captura sea siempre la misma
      // sin importar cuánto haya scrolleado el usuario.
      html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      // 'css' hace que html2pdf respete los page-break-inside:avoid del HTML (Condiciones
      // Generales, cada párrafo, la tabla de ítems, el total) para no cortarlos a la mitad
      // entre dos páginas. 'legacy' es el resto del comportamiento de paginación por defecto.
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(el).save().then(() => {
      document.body.removeChild(el);
      notify('PDF generado correctamente');
    }).catch(err => {
      document.body.removeChild(el);
      console.error('Error generando PDF (invoice):', err);
      notify('Error generando PDF: ' + (err && err.message ? err.message : String(err)), 'error');
    });
  } catch (err) {
    document.body.removeChild(el);
    console.error('Error iniciando html2pdf (invoice):', err);
    notify('Error generando PDF: ' + (err && err.message ? err.message : String(err)), 'error');
  }
};

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
async function init() {
  // Initialize DB (may be async in Firebase mode)
  const maybeInit = DB.init();
  // Wait for init if it returns a promise
  if (maybeInit && typeof maybeInit.then === 'function') await maybeInit;

  // After DB initialized, ensure all budgets have a proper reference number
  await ensureBudgetNumbers();

  // Expose navigate globally for onclick handlers
  window.navigate = navigate;
  // Start router
  route(window.location.hash);
}

// Preview budget PDF HTML in a new window before exporting
window.previewBudgetPDF = function(budgetId) {
  const budget = DB.get('budgets', budgetId);
  if (!budget) { notify('Presupuesto no encontrado', 'error'); return; }

  const fragment = window.buildBudgetHtmlFragment(budget);
  const displayNumber = formatBudgetRef(budget.number ?? budget.budgetNumber ?? '(sin número)');
  const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa — ${esc(displayNumber)}</title></head><body><div style="margin-bottom:12px"><button onclick="(function(){ if(window.opener && typeof window.opener.exportBudgetPDF==='function'){ window.opener.exportBudgetPDF('${budgetId}'); } else { alert('No se puede exportar desde aquí'); } })()" style="padding:8px 12px;margin-right:8px">Exportar PDF</button><button onclick="window.print()" style="padding:8px 12px">Imprimir</button></div>${fragment}</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=800,scrollbars=yes');
  if (!w) { notify('El navegador bloqueó la ventana emergente. Permití popups para previsualizar.', 'warning'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
};

document.addEventListener('DOMContentLoaded', () => {
  // allow async init
  init().catch(err => console.error('Error en init():', err));
});

// Helper: call function that might return promise and always return a Promise
function callMaybeAsync(fn, ...args) {
  try {
    const r = fn(...args);
    if (r && typeof r.then === 'function') return r;
    return Promise.resolve(r);
  } catch (e) {
    return Promise.reject(e);
  }
}

// Ensure budgets have valid yymmddNNN numbers. Assign new ones when missing/invalid.
async function ensureBudgetNumbers() {
  try {
    const budgets = DB.getAll('budgets') || [];
    const invalid = budgets.filter(b => {
      const n = b.number ?? b.budgetNumber ?? b.invoiceNumber ?? '';
      if (!n) return true;
      const s = String(n);
      return !/^\d{9}$/.test(s); // expecting 9 digits yymmddNNN
    });
    if (!invalid.length) return;
    console.log(`🔧 Migrating ${invalid.length} budgets without proper number...`);
    for (const b of invalid) {
      try {
        const num = await callMaybeAsync(DB.nextBudgetNumber.bind(DB));
        if (!num) continue;
        // Prefer updating `number` field
        DB.update('budgets', b.id, { number: num });
        console.log(`Assigned number ${num} to budget ${b.id}`);
      } catch (e) {
        console.error('Error assigning budget number for', b.id, e);
      }
    }
    console.log('🔧 Budget number migration complete');
  } catch (e) {
    console.error('Error in ensureBudgetNumbers:', e);
  }
}