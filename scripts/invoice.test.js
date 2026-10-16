const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function firestoreMock() {
  const rows = new Map();
  const listeners = new Map();
  let sequence = 0;
  let queue = Promise.resolve();
  let failNext = false;
  const snapshot = key => ({ id: key.split('/').pop(), exists: rows.has(key), data: () => structuredClone(rows.get(key)) });
  const collectionSnapshot = (key, filter) => ({
    forEach(fn) {
      for (const [id, data] of rows) {
        if (id.startsWith(key + '/') && !id.slice(key.length + 1).includes('/') && (!filter || filter(data))) fn(snapshot(id));
      }
    }
  });
  const notify = () => listeners.forEach((fn, key) => fn(key.split('/').length % 2 ? collectionSnapshot(key) : snapshot(key)));
  function ref(key) {
    return {
      key, id: key.split('/').pop(),
      collection: name => collection(key + '/' + name),
      get: async () => snapshot(key),
      set: async (data, options) => { rows.set(key, options?.merge ? { ...rows.get(key), ...structuredClone(data) } : structuredClone(data)); notify(); },
      update: async data => { rows.set(key, { ...rows.get(key), ...structuredClone(data) }); notify(); },
      delete: async () => { rows.delete(key); notify(); },
      onSnapshot(fn) { listeners.set(key, fn); fn(snapshot(key)); return () => listeners.delete(key); }
    };
  }
  function collection(key) {
    return {
      doc: id => ref(key + '/' + (id || `generated-${++sequence}`)),
      get: async () => collectionSnapshot(key),
      add: async data => { const doc = ref(key + '/generated-' + ++sequence); await doc.set(data); return doc; },
      where: (field, operator, value) => ({ get: async () => collectionSnapshot(key, data => data[field] === value) }),
      onSnapshot(fn) { listeners.set(key, fn); fn(collectionSnapshot(key)); return () => listeners.delete(key); }
    };
  }
  return {
    collection,
    failNextTransaction() { failNext = true; },
    runTransaction(fn) {
      const result = queue.then(async () => {
        const writes = [];
        const value = await fn({
          get: async doc => snapshot(doc.key),
          set: (doc, data, options) => writes.push(() => rows.set(doc.key, options?.merge ? { ...rows.get(doc.key), ...structuredClone(data) } : structuredClone(data))),
          update: (doc, data) => writes.push(() => rows.set(doc.key, { ...rows.get(doc.key), ...structuredClone(data) })),
          delete: doc => writes.push(() => rows.delete(doc.key))
        });
        if (failNext) { failNext = false; throw new Error('Simulated transaction failure'); }
        writes.forEach(write => write());
        notify();
        return value;
      });
      queue = result.catch(() => {});
      return result;
    }
  };
}

async function harness(adapter, production = false) {
  const storage = new Map();
  const elements = new Map();
  const notifications = [];
  let clock = new Date(2026, 9, 10, 12).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const backend = firestoreMock();
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} }, Date: Clock, setTimeout, clearTimeout,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: {
      addEventListener() {},
      querySelectorAll: () => [],
      getElementById: id => {
        if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '' });
        return elements.get(id);
      },
      createElement: () => ({ innerHTML: '', childNodes: [] })
    },
    location: { hash: '#/projects/p/invoices/new', pathname: '/', search: '' },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class {},
    isDemoMode: !production,
    Auth: { getUserId: () => 'user', isAuthenticated: () => true },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' } } },
    db: backend,
    Swal: { fire: async options => { notifications.push(options); return { isConfirmed: true }; } }
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root, adapter), 'utf8'), context);
  context.DB = vm.runInContext('DB', context);
  if (production) await context.DB.init();
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);
  const project = { id: 'p', administration: 'USA', name: 'Project', client: 'Project client', budgetAmount: 100, date: '2026-09-01' };
  if (production) await context.DB.add('projects', project);
  else storage.set('aurea2_projects', JSON.stringify([project]));
  return {
    context, backend, notifications,
    tomorrow() { clock = new Date(2026, 9, 11, 12).getTime(); },
    form(invoice) {
      context.location.hash = '#/editing';
      const values = {
        'inv-client': invoice?.clientName ?? 'Invoice client',
        'inv-date': invoice?.date ?? '2026-10-10',
        'inv-due': invoice?.dueDate ?? '',
        'inv-status': invoice?.status ?? 'pendiente',
        'inv-notes': invoice?.notes ?? ''
      };
      Object.entries(values).forEach(([id, value]) => context.document.getElementById(id).value = value);
      context._invItems = invoice?.items.map(item => ({ ...item })) ?? [{ description: 'Original service', qty: 1, unitPrice: 100 }];
      context._invoiceEditVersion = invoice ? (invoice.version || 1) : null;
    }
  };
}

for (const [label, adapter, production] of [
  ['local', 'db.js', false],
  ['Firebase demo', 'db-firebase.js', false],
  ['Firebase transactions', 'db-firebase.js', true]
]) {
  test(`${label}: versions, numbering, totals, history and historical PDFs`, async () => {
    const h = await harness(adapter, production);
    const { context: c } = h;
    await c.DB.add('budgets', { id: 'budget', projectId: 'p', number: '260901001', status: 'aprobado-total' });
    h.form();
    await c.saveInvoiceForm('p', '');
    let invoice = c.DB.getInvoicesByProject('p')[0];
    assert.match(invoice.number, /^261010\d{3}$/);
    assert.notEqual(invoice.number, '260901001');
    assert.equal(invoice.version, 1);
    const originalNumber = invoice.number;
    h.form(invoice);
    await c.saveInvoiceForm('p', invoice.id);
    assert.equal(c.DB.get('invoices', invoice.id).version, 1, 'unchanged saves must not create a revision');
    h.tomorrow();
    h.form(invoice);
    c.document.getElementById('inv-date').value = '2026-10-11';
    c._invItems.push({ description: 'Additional service', qty: 2, unitPrice: 75 });
    c.document.getElementById('inv-client').value = 'Updated client';
    c.document.getElementById('inv-notes').value = 'Updated terms';
    await c.saveInvoiceForm('p', invoice.id);
    invoice = c.DB.get('invoices', invoice.id);
    assert.match(invoice.number, /^261011\d{3}$/);
    assert.equal(invoice.date, '2026-10-11');
    assert.equal(invoice.version, 2);
    assert.equal(invoice.total, 250);
    assert.equal(invoice.history.length, 1);
    assert.equal(invoice.history[0].number, originalNumber);
    assert.equal(invoice.history[0].total, 100);
    assert.equal(invoice.history[0].items.length, 1);
    assert.equal(invoice.history[0].clientName, 'Invoice client');
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 250);
    assert.equal(c.DB.getProjectFinancials('p').budgetTotal, 250);
    assert.equal(c.DB.getProjectFinancials('p').profit, 250, 'USA profit must follow the current invoice amount without adding income records');
    await c.DB.add('expenses', { projectId: 'p', amount: 25 });
    assert.equal(c.DB.getProjectFinancials('p').profit, 225);
    const oldPdf = c.buildInvoiceHtmlFragment(invoice.id, 1);
    assert.ok(oldPdf.includes(c.formatBudgetRef(originalNumber)));
    assert.ok(oldPdf.includes('Original service'));
    assert.ok(!oldPdf.includes('Additional service'));
    assert.ok(!oldPdf.includes('Updated terms'));
    assert.ok(c.buildInvoiceHtmlFragment(invoice.id, 2).includes('Additional service'));
    assert.equal(c.buildInvoiceHtmlFragment(invoice.id, 99), '');
    assert.ok(c.renderTabHistory(c.DB.get('projects', 'p')).includes('Versión 1'));
    c.renderInvoiceForm('p', invoice.id);
    assert.ok(c.document.getElementById('main-content').innerHTML.includes('value="Updated client"'));
    h.form();
    c._invItems = [{ description: 'Independent invoice', qty: 1, unitPrice: 50 }];
    await c.saveInvoiceForm('p', '');
    const invoices = c.DB.getInvoicesByProject('p');
    assert.equal(invoices.length, 2);
    assert.equal(new Set(invoices.map(inv => inv.number)).size, 2);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 300, 'history must not be double counted');
    await assert.rejects(async () => c.DB.saveProjectInvoice('p', invoice.id, { ...invoice, total: 999 }, 1), /factura cambió/);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 300);
    await c.DB.saveProjectInvoice('p', invoices[1].id, null, 1);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 250);
    await c.ensureInvoicesFromApprovedBudgets(c.DB.get('projects', 'p'));
    assert.equal(c.DB.getInvoicesByProject('p').length, 1, 'viewing invoices must not recreate deleted ones');
  });

  test(`${label}: automatic invoice creation is awaited, dated today and idempotent`, async () => {
    const h = await harness(adapter, production);
    const c = h.context;
    const budget = await c.DB.add('budgets', { id: 'approved', projectId: 'p', administration: 'USA', status: 'aprobado-total', date: '2026-09-01', items: [{ description: 'Budget item', qty: 1, unitPrice: 125 }] });
    await c.ensureInvoicesFromApprovedBudgets(c.DB.get('projects', 'p'));
    const invoice = c.DB.getInvoicesByProject('p')[0];
    assert.equal(invoice.date, '2026-10-10');
    assert.equal(typeof invoice.number, 'string');
    assert.match(invoice.number, /^261010\d{3}$/);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 125);
    await c.createInvoiceFromBudget(budget.id, { navigate: false });
    assert.equal(c.DB.getInvoicesByProject('p').length, 1);
  });

  test(`${label}: legacy invoice is archived on its first edit and non-USA projects remain blocked`, async () => {
    const h = await harness(adapter, production);
    const c = h.context;
    const legacy = await c.DB.add('invoices', { projectId: 'p', number: '260901001', clientName: 'Legacy client', date: '2026-09-01', items: [{ description: 'Legacy', qty: 1, unitPrice: 80 }], total: 80, status: 'pendiente' });
    h.form(legacy);
    c._invItems[0].unitPrice = 120;
    await c.saveInvoiceForm('p', legacy.id);
    assert.equal(c.DB.get('invoices', legacy.id).history[0].total, 80);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 120);
    const arg = await c.DB.add('projects', { id: 'arg', administration: 'ARG' });
    await assert.rejects(async () => c.DB.saveProjectInvoice(arg.id, null, { total: 1 }), /USA/);
    assert.equal(c.DB.getInvoicesByProject(arg.id).length, 0);
    assert.equal(c.DB.getProjectFinancials(arg.id).profit, 0);
  });

  test(`${label}: editing an approved budget does not overwrite invoice-based project amounts`, async () => {
    const h = await harness(adapter, production);
    const c = h.context;
    await c.DB.saveProjectInvoice('p', null, { version: 1, total: 130 });
    const budget = await c.DB.add('budgets', { projectId: 'p', administration: 'USA', status: 'aprobado-total', items: [{ description: 'Budget', qty: 1, unitPrice: 100 }] });
    c._liItems = [{ description: 'Changed budget', qty: 1, unitPrice: 500 }];
    c.document.getElementById('b-admin').value = 'USA';
    c.document.getElementById('b-status').value = 'aprobado-total';
    await c.saveBudgetForm('p', budget.id);
    assert.equal(c.DB.get('budgets', budget.id).total, 500);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 130);
  });

  test(`${label}: selected dates control unique numbers for new invoices and date-only revisions`, async () => {
    const h = await harness(adapter, production);
    const c = h.context;
    await c.DB.add('budgets', { number: '260915007' });
    await c.DB.add('invoices', {
      projectId: 'other', number: '260920001', history: [{ number: '260915009', version: 1 }]
    });
    h.form();
    c.document.getElementById('inv-date').value = '2026-09-15';
    await c.saveInvoiceForm('p', '');
    let invoice = c.DB.getInvoicesByProject('p')[0];
    assert.equal(invoice.date, '2026-09-15');
    assert.equal(invoice.number, '260915010', 'skip legacy and historical numbers even with empty counters');
    const firstNumber = invoice.number;
    h.form(invoice);
    c.document.getElementById('inv-date').value = '2026-09-16';
    await c.saveInvoiceForm('p', invoice.id);
    invoice = c.DB.get('invoices', invoice.id);
    assert.equal(invoice.number, '260916001');
    assert.equal(invoice.version, 2);
    assert.equal(invoice.history[0].date, '2026-09-15');
    assert.equal(invoice.history[0].number, firstNumber);
    assert.equal(invoice.total, 100);
    h.form(invoice);
    c.document.getElementById('inv-date').value = '2026-09-15';
    await c.saveInvoiceForm('p', invoice.id);
    invoice = c.DB.get('invoices', invoice.id);
    assert.equal(invoice.number, '260915011', 'returning to an earlier date must allocate a fresh number');
    h.form();
    c.document.getElementById('inv-date').value = '2026-09-15';
    await c.saveInvoiceForm('p', '');
    const invoices = c.DB.getInvoicesByProject('p');
    assert.equal(invoices[1].number, '260915012');
    const numbers = invoices.flatMap(inv => [inv.number, ...(inv.history || []).map(version => version.number)]);
    assert.equal(new Set(numbers).size, numbers.length);
    c.renderInvoiceForm('p', invoice.id);
    assert.ok(!/id="inv-date"[^>]*(readonly|disabled)/.test(c.document.getElementById('main-content').innerHTML));
    h.form();
    c.renderInvoiceForm('p', null);
    assert.ok(!/id="inv-date"[^>]*(readonly|disabled)/.test(c.document.getElementById('main-content').innerHTML));
    assert.ok(c.buildInvoiceHtmlFragment(invoice.id, 1).includes('260915-010'));
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 200);
    for (const invalid of ['', '2026-02-30', 'not-a-date']) {
      await assert.rejects(async () => c.DB.nextBudgetNumber(invalid), /fecha.*válida/);
    }
    h.form(invoice);
    c.document.getElementById('inv-date').value = '';
    await c.saveInvoiceForm('p', invoice.id);
    assert.equal(c.DB.get('invoices', invoice.id).version, 3);
    assert.ok(h.notifications.at(-1).title.includes('fecha de factura válida'));
  });
}

for (const adapter of ['db.js', 'db-firebase.js']) {
  test(`${adapter}: local storage failure rolls back invoice and project`, async () => {
    const h = await harness(adapter);
    const c = h.context;
    const originalSet = c.localStorage.setItem;
    let fail = true;
    c.localStorage.setItem = (key, value) => {
      if (fail && key === 'aurea2_projects') {
        fail = false;
        throw new Error('Storage quota exceeded');
      }
      originalSet(key, value);
    };
    await assert.rejects(async () => c.DB.saveProjectInvoice('p', null, { version: 1, total: 200 }), /Storage quota/);
    assert.equal(c.DB.getInvoicesByProject('p').length, 0);
    assert.equal(c.DB.get('projects', 'p').budgetAmount, 100);
  });
}

test('Invoice Enter handler works without visiting the budget editor', async () => {
  const h = await harness('db.js');
  let added = 0;
  let prevented = 0;
  h.context.addInvRow = () => added++;
  h.context.invDescKeyDown({ key: 'Enter', shiftKey: false, preventDefault: () => prevented++ });
  h.context.invDescKeyDown({ key: 'Enter', shiftKey: true, preventDefault: () => prevented++ });
  assert.equal(added, 1);
  assert.equal(prevented, 1);
});

test('Firebase transaction failure leaves both invoice and project unchanged', async () => {
  const h = await harness('db-firebase.js', true);
  h.backend.failNextTransaction();
  await assert.rejects(h.context.DB.saveProjectInvoice('p', null, { total: 200, version: 1, items: [] }), /Simulated transaction failure/);
  assert.equal(h.context.DB.getInvoicesByProject('p').length, 0);
  assert.equal(h.context.DB.get('projects', 'p').budgetAmount, 100);
});

test('Firebase concurrent creates preserve all totals and prevent duplicate budget invoices', async () => {
  const h = await harness('db-firebase.js', true);
  const c = h.context;
  await Promise.all([
    c.DB.saveProjectInvoice('p', null, { total: 100, version: 1 }),
    c.DB.saveProjectInvoice('p', null, { total: 200, version: 1 })
  ]);
  assert.equal(c.DB.get('projects', 'p').budgetAmount, 300);
  const invoices = await Promise.all([
    c.DB.saveProjectInvoice('p', null, { budgetId: 'b', total: 50, version: 1 }),
    c.DB.saveProjectInvoice('p', null, { budgetId: 'b', total: 50, version: 1 })
  ]);
  assert.equal(invoices[0].id, invoices[1].id);
  assert.equal(c.DB.get('projects', 'p').budgetAmount, 350);
});

test('Firebase simultaneous edits reject the stale version without losing totals', async () => {
  const h = await harness('db-firebase.js', true);
  const c = h.context;
  const invoice = await c.DB.saveProjectInvoice('p', null, { version: 1, total: 100, history: [] });
  const results = await Promise.allSettled([
    c.DB.saveProjectInvoice('p', invoice.id, { version: 2, total: 200, history: [{ version: 1, total: 100 }] }, 1),
    c.DB.saveProjectInvoice('p', invoice.id, { version: 2, total: 300, history: [{ version: 1, total: 100 }] }, 1)
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(c.DB.get('invoices', invoice.id).history.length, 1);
  assert.equal(c.DB.get('projects', 'p').budgetAmount, c.DB.get('invoices', invoice.id).total);
});

test('Firebase concurrent number allocation for the selected date remains unique', async () => {
  const h = await harness('db-firebase.js', true);
  const c = h.context;
  await c.DB.add('invoices', { number: '261101004', history: [{ number: '261101005' }] });
  const numbers = await Promise.all(Array.from({ length: 5 }, () => c.DB.nextBudgetNumber('2026-11-01')));
  assert.equal(new Set(numbers).size, 5);
  assert.deepEqual([...numbers].sort(), ['261101006', '261101007', '261101008', '261101009', '261101010']);
});
