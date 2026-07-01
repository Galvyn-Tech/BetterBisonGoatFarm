/* ============================================================
   BBGF — Goat Farm Management · app.js
   Vanilla JS + Supabase v2 (CDN)

   ⚠  SETUP REQUIRED:
   Replace SUPABASE_URL and SUPABASE_ANON_KEY below with your
   actual Supabase project credentials before opening the app.
   ============================================================ */

const SUPABASE_URL      = 'https://swdtrkpdxitdtopkdgxs.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3ZHRya3BkeGl0ZHRvcGtkZ3hzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4OTk0MDQsImV4cCI6MjA5ODQ3NTQwNH0.-xScsqP1Itam9XC2KDZIZLHWGOiXXzt4MtBtcR7JM6g';

/* Guard: ensure Supabase CDN loaded before initialising */
if (!window.supabase) {
  document.body.innerHTML =
    '<div style="color:#ef4444;font-family:monospace;padding:40px;font-size:15px;">'
    + '⚠ Supabase CDN failed to load. Check your internet connection and refresh.'
    + '</div>';
  throw new Error('Supabase CDN not loaded.');
}

if (SUPABASE_URL.includes('YOUR_') || SUPABASE_ANON_KEY.includes('YOUR_')) {
  document.body.innerHTML =
    '<div style="color:#f59e0b;font-family:monospace;padding:40px;font-size:15px;">'
    + '⚠ Open <b>app.js</b> and replace <b>YOUR_SUPABASE_PROJECT_URL</b> and '
    + '<b>YOUR_SUPABASE_ANON_KEY</b> with your real Supabase credentials.'
    + '</div>';
  throw new Error('Supabase credentials not set.');
}

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================================================
   APP STATE
   ============================================================ */
let allInvestors    = [];
let allGoats        = [];
let cachedMedMap    = {};
let cachedOffspring = {};
let currentFilter   = 'ALL';
let editingLedgerId   = null;
let editingCashflowId = null;
let editingGoatId     = null;
let cachedLedger      = [];
let cachedCashflow    = [];

/* ============================================================
   UTILITY HELPERS
   ============================================================ */

/**
 * Escape a string to prevent XSS when injecting into HTML.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

function formatCurrency(amount) {
  const n = Number(amount || 0);
  return '₹\u00a0' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return 'Unknown';
  const birth = new Date(birthDateStr);
  if (isNaN(birth)) return 'Unknown';
  const now    = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 +
                 (now.getMonth()    - birth.getMonth());
  if (months < 1)  return 'Newborn';
  if (months < 12) return `${months}mo`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m > 0 ? `${y}y ${m}mo` : `${y}y`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/* ============================================================
   TOAST NOTIFICATIONS
   ============================================================ */
let toastTimer = null;
function showToast(message, type = 'success') {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.textContent = message;
  el.className   = `toast show ${type}`;
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
}

/* ============================================================
   BUTTON LOADING STATE
   ============================================================ */
function setLoading(btn, isLoading) {
  if (isLoading) {
    btn.dataset.orig = btn.textContent;
    btn.textContent  = 'Processing…';
    btn.disabled     = true;
  } else {
    btn.textContent = btn.dataset.orig || btn.textContent;
    btn.disabled    = false;
  }
}

/* Inline two-click delete confirmation */
function requireConfirm(btn, callback) {
  if (btn.dataset.confirming === 'true') {
    clearTimeout(btn._confirmTimer);
    btn.dataset.confirming = 'false';
    btn.textContent        = btn.dataset.origText;
    btn.style.cssText      = btn.dataset.origStyle || '';
    callback();
  } else {
    btn.dataset.confirming = 'true';
    btn.dataset.origText   = btn.textContent;
    btn.dataset.origStyle  = btn.style.cssText;
    btn.textContent        = 'Sure?';
    btn.style.background   = 'var(--red)';
    btn.style.color        = '#fff';
    btn.style.borderColor  = 'var(--red)';
    btn._confirmTimer = setTimeout(() => {
      btn.dataset.confirming = 'false';
      btn.textContent        = btn.dataset.origText;
      btn.style.cssText      = btn.dataset.origStyle || '';
    }, 3000);
  }
}

/* ============================================================
   MODAL CONTROLS
   ============================================================ */
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  /* Pre-fill today's date in any empty date inputs */
  modal.querySelectorAll('input[type="date"]').forEach(inp => {
    if (!inp.value) inp.value = todayISO();
  });

  /* Populate dropdowns as needed */
  if (id === 'modal-add-investment') populateInvestorDropdown()
      .catch(err => console.error('[Dropdown] Failed to load investors:', err));
  if (id === 'modal-register-goat')  populateParentDropdowns()
      .catch(err => console.error('[Dropdown] Failed to load goats:', err));

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('open');
  document.body.style.overflow = '';
  const form = modal.querySelector('form');
  if (form) form.reset();
  /* Reset edit states */
  if (id === 'modal-add-investment') {
    editingLedgerId = null;
    document.querySelector('#modal-add-investment .modal-header h3').textContent = 'Add Investment';
    document.getElementById('btn-submit-investment').textContent = 'Confirm Investment';
  }
  if (id === 'modal-register-goat') {
    editingGoatId = null;
    document.querySelector('#modal-register-goat .modal-header h3').textContent = 'Register New Goat';
    document.getElementById('btn-submit-goat').textContent = 'Register Goat';
  }
}

/* Close modals when clicking the backdrop */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', function (e) {
    if (e.target !== this) return;
    this.classList.remove('open');
    document.body.style.overflow = '';
    const form = this.querySelector('form');
    if (form) form.reset();
  });
});

/* ============================================================
   TAB NAVIGATION
   ============================================================ */
function initTabs() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');

      const target = this.dataset.tab;
      document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
      document.getElementById(`tab-${target}`).classList.add('active');
    });
  });
}

/* ============================================================
   TAB 1 — INVESTORS
   ============================================================ */
async function loadInvestors() {
  try {
    const [{ data: investors, error: iErr }, { data: ledger, error: lErr }] =
      await Promise.all([
        db.from('investors').select('*').order('total_invested', { ascending: false }),
        db.from('investment_ledger')
          .select('*, investors(name)')
          .order('invested_at', { ascending: false })
      ]);

    if (iErr) throw iErr;
    if (lErr) throw lErr;

    allInvestors = investors || [];
    renderInvestorCards(allInvestors);
    renderLedger(ledger || []);
    updateInvestorStats(allInvestors, ledger || []);
  } catch (err) {
    console.error('[Investors] Load error:', err);
    document.getElementById('investor-cards').innerHTML =
      '<div class="loading-state">⚠ Failed to load investor data.</div>';
    showToast('Failed to load investor data.', 'error');
  }
}

function renderInvestorCards(investors) {
  const container = document.getElementById('investor-cards');
  if (!investors.length) {
    container.innerHTML = '<div class="loading-state">No investors found.</div>';
    return;
  }
  const total = investors.reduce((s, i) => s + Number(i.total_invested || 0), 0);

  container.innerHTML = investors.map((inv, idx) => {
    const equity = total > 0
      ? ((Number(inv.total_invested || 0) / total) * 100).toFixed(1)
      : Number(inv.equity_percentage || 0).toFixed(1);

    return `
      <div class="investor-card">
        <div class="investor-rank">Partner #${idx + 1}</div>
        <div class="investor-name">${escapeHtml(inv.name)}</div>
        <div class="investor-metrics">
          <div class="metric-item">
            <span class="metric-label">Invested</span>
            <span class="metric-value">${formatCurrency(inv.total_invested)}</span>
          </div>
          <div class="metric-item">
            <span class="metric-label">Equity</span>
            <span class="metric-value highlight">${equity}%</span>
          </div>
        </div>
        <div class="equity-bar">
          <div class="equity-fill" style="width:${equity}%"></div>
        </div>
      </div>`;
  }).join('');
}

function renderLedger(ledger) {
  cachedLedger = ledger;
  const tbody = document.getElementById('ledger-tbody');
  if (!ledger.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No transactions recorded yet.</td></tr>';
    return;
  }
  tbody.innerHTML = ledger.map(tx => `
    <tr>
      <td>${formatDate(tx.invested_at)}</td>
      <td>${escapeHtml(tx.investors?.name || '—')}</td>
      <td class="amount-positive">${formatCurrency(tx.amount)}</td>
      <td class="action-cell">
        <button class="btn-icon btn-icon-edit"   onclick="openEditLedger('${escapeHtml(tx.transaction_id)}')">&#9998; Edit</button>
        <button class="btn-icon btn-icon-danger" onclick="deleteLedgerRow('${escapeHtml(tx.transaction_id)}', this)">✕ Del</button>
      </td>
    </tr>`).join('');
}

function updateInvestorStats(investors, ledger) {
  const total = investors.reduce((s, i) => s + Number(i.total_invested || 0), 0);
  document.getElementById('stat-total-capital').textContent    = formatCurrency(total);
  document.getElementById('stat-total-investors').textContent  = investors.length;
  document.getElementById('stat-last-investment').textContent  =
    ledger.length ? formatDate(ledger[0].invested_at) : '—';
}

async function populateInvestorDropdown() {
  const sel = document.getElementById('inv-investor-id');
  sel.innerHTML = '<option value="">Loading…</option>';

  /* Always fetch fresh from DB so the list is never stale */
  const { data, error } = await db
    .from('investors')
    .select('investor_id, name')
    .order('name', { ascending: true });

  if (error) {
    sel.innerHTML = '<option value="">⚠ Failed to load investors</option>';
    console.error('[Dropdown] Investors fetch error:', error);
    return;
  }

  /* Also update the global cache */
  if (data && data.length) allInvestors = data;

  sel.innerHTML = '<option value="">Select investor…</option>';
  (data || []).forEach(inv => {
    sel.innerHTML += `<option value="${escapeHtml(inv.investor_id)}">${escapeHtml(inv.name)}</option>`;
  });

  if (!data || data.length === 0) {
    sel.innerHTML = '<option value="">No investors found — add rows in Supabase first</option>';
  }
}

async function recalcInvestorTotals() {
  const { data: allLedger, error } = await db.from('investment_ledger').select('investor_id, amount');
  if (error) throw error;
  const totalsMap = {};
  allLedger.forEach(tx => {
    totalsMap[tx.investor_id] = (totalsMap[tx.investor_id] || 0) + Number(tx.amount);
  });
  const grandTotal = Object.values(totalsMap).reduce((s, v) => s + v, 0);
  await Promise.all(
    Object.entries(totalsMap).map(([id, tot]) =>
      db.from('investors').update({
        total_invested:    tot,
        equity_percentage: grandTotal > 0
          ? parseFloat(((tot / grandTotal) * 100).toFixed(4))
          : 0
      }).eq('investor_id', id)
    )
  );
}

async function submitAddInvestment() {
  const investorId = document.getElementById('inv-investor-id').value.trim();
  const amount     = parseFloat(document.getElementById('inv-amount').value);
  const date       = document.getElementById('inv-date').value;

  if (!investorId || !amount || amount <= 0 || !date) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-investment');
  setLoading(btn, true);

  try {
    if (editingLedgerId) {
      const { error } = await db.from('investment_ledger')
        .update({ investor_id: investorId, amount, invested_at: date })
        .eq('transaction_id', editingLedgerId);
      if (error) throw error;
    } else {
      const { error } = await db.from('investment_ledger')
        .insert({ investor_id: investorId, amount, invested_at: date });
      if (error) throw error;
    }

    await recalcInvestorTotals();
    showToast(editingLedgerId ? 'Investment updated!' : 'Investment recorded!');
    closeModal('modal-add-investment');
    loadInvestors();
  } catch (err) {
    console.error('[Investment] Submit error:', err);
    showToast('Failed to save investment. ' + (err.message || ''), 'error');
  } finally {
    setLoading(btn, false);
  }
}

function openEditLedger(txId) {
  const tx = cachedLedger.find(t => t.transaction_id === txId);
  if (!tx) return;
  editingLedgerId = txId;
  document.querySelector('#modal-add-investment .modal-header h3').textContent = 'Edit Investment';
  document.getElementById('btn-submit-investment').textContent = 'Save Changes';
  const modal = document.getElementById('modal-add-investment');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  populateInvestorDropdown().then(() => {
    document.getElementById('inv-investor-id').value = tx.investor_id || '';
    document.getElementById('inv-amount').value      = tx.amount      || '';
    document.getElementById('inv-date').value        = tx.invested_at ? tx.invested_at.split('T')[0] : '';
  }).catch(console.error);
}

async function deleteLedgerRow(txId, btn) {
  requireConfirm(btn, async () => {
    try {
      const { error } = await db.from('investment_ledger').delete().eq('transaction_id', txId);
      if (error) throw error;
      await recalcInvestorTotals();
      showToast('Transaction deleted.');
      loadInvestors();
    } catch (err) {
      showToast('Delete failed. ' + (err.message || ''), 'error');
    }
  });
}

/* ============================================================
   TAB 2 — CASHFLOW
   ============================================================ */
async function loadCashflow() {
  try {
    const { data, error } = await db
      .from('cashflow')
      .select('*')
      .order('date', { ascending: false });

    if (error) throw error;
    renderCashflowTable(data || []);
    updateCashflowStats(data || []);
  } catch (err) {
    console.error('[Cashflow] Load error:', err);
    document.getElementById('cashflow-tbody').innerHTML =
      '<tr><td colspan="5" class="empty-cell">⚠ Failed to load cashflow data.</td></tr>';
    showToast('Failed to load cashflow data.', 'error');
  }
}

function renderCashflowTable(rows) {
  cachedCashflow = rows;
  const tbody = document.getElementById('cashflow-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">No records yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(row => {
    const badge = row.type === 'PROFIT'
      ? '<span class="badge badge-profit">Profit</span>'
      : row.type === 'EXPENSE'
      ? '<span class="badge badge-expense">Expense</span>'
      : '<span class="badge badge-saving">Saving</span>';

    const amtClass = row.type === 'PROFIT'
      ? 'amount-positive'
      : row.type === 'EXPENSE' ? 'amount-negative' : '';

    return `
      <tr>
        <td>${formatDate(row.date)}</td>
        <td>${badge}</td>
        <td>${escapeHtml(row.category || '—')}</td>
        <td class="${amtClass}">${formatCurrency(row.amount)}</td>
        <td style="color:var(--text-secondary);white-space:normal;max-width:220px;">${escapeHtml(row.description || '—')}</td>
        <td class="action-cell">
          <button class="btn-icon btn-icon-edit"   onclick="openEditCashflow('${escapeHtml(row.id)}')">&#9998; Edit</button>
          <button class="btn-icon btn-icon-danger" onclick="deleteCashflowRow('${escapeHtml(row.id)}', this)">✕ Del</button>
        </td>
      </tr>`;
  }).join('');
}

function updateCashflowStats(rows) {
  const sum   = (type) => rows.filter(r => r.type === type).reduce((s, r) => s + Number(r.amount || 0), 0);
  const profit  = sum('PROFIT');
  const expense = sum('EXPENSE');
  const saving  = sum('SAVING');
  const net     = profit - expense;

  document.getElementById('stat-total-profit').textContent   = formatCurrency(profit);
  document.getElementById('stat-total-expenses').textContent = formatCurrency(expense);
  document.getElementById('stat-total-savings').textContent  = formatCurrency(saving);

  const netEl   = document.getElementById('stat-net-balance');
  netEl.textContent = (net < 0 ? '−' : '') + formatCurrency(Math.abs(net));
  netEl.className   = `stat-value ${net >= 0 ? 'emerald' : 'red'}`;
}

async function submitAddCashflow(type) {
  /* Resolve field IDs per type */
  const prefix = { EXPENSE: 'exp', PROFIT: 'prf', SAVING: 'sav' }[type];
  const modalId = { EXPENSE: 'modal-add-expense', PROFIT: 'modal-add-profit', SAVING: 'modal-add-saving' }[type];
  const btnId   = { EXPENSE: 'btn-submit-expense', PROFIT: 'btn-submit-profit', SAVING: 'btn-submit-saving' }[type];

  const category    = document.getElementById(`${prefix}-category`).value.trim();
  const amount      = parseFloat(document.getElementById(`${prefix}-amount`).value);
  const description = document.getElementById(`${prefix}-description`).value.trim();
  const date        = document.getElementById(`${prefix}-date`).value;

  if (!category || !amount || amount <= 0 || !date) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const btn = document.getElementById(btnId);
  setLoading(btn, true);

  try {
    const { error } = await db.from('cashflow').insert({ type, category, amount, description, date });
    if (error) throw error;

    const label = type.charAt(0) + type.slice(1).toLowerCase();
    showToast(`${label} logged successfully!`);
    closeModal(modalId);
    loadCashflow();
  } catch (err) {
    console.error('[Cashflow] Submit error:', err);
    showToast('Failed to save record. ' + (err.message || ''), 'error');
  } finally {
    setLoading(btn, false);
  }
}

function openEditCashflow(id) {
  const row = cachedCashflow.find(r => r.id === id);
  if (!row) return;
  editingCashflowId = id;
  document.getElementById('edit-cf-id').value          = id;
  document.getElementById('edit-cf-type').value        = row.type        || 'PROFIT';
  document.getElementById('edit-cf-category').value    = row.category    || '';
  document.getElementById('edit-cf-amount').value      = row.amount      || '';
  document.getElementById('edit-cf-description').value = row.description || '';
  document.getElementById('edit-cf-date').value        = row.date ? row.date.split('T')[0] : '';
  const modal = document.getElementById('modal-edit-cashflow');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

async function submitEditCashflow() {
  const id          = document.getElementById('edit-cf-id').value;
  const type        = document.getElementById('edit-cf-type').value;
  const category    = document.getElementById('edit-cf-category').value.trim();
  const amount      = parseFloat(document.getElementById('edit-cf-amount').value);
  const description = document.getElementById('edit-cf-description').value.trim();
  const date        = document.getElementById('edit-cf-date').value;

  if (!category || !amount || amount <= 0 || !date) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-edit-cashflow');
  setLoading(btn, true);

  try {
    const { error } = await db.from('cashflow')
      .update({ type, category, amount, description, date })
      .eq('id', id);
    if (error) throw error;
    showToast('Record updated!');
    closeModal('modal-edit-cashflow');
    loadCashflow();
  } catch (err) {
    showToast('Update failed. ' + (err.message || ''), 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function deleteCashflowRow(id, btn) {
  requireConfirm(btn, async () => {
    try {
      const { error } = await db.from('cashflow').delete().eq('id', id);
      if (error) throw error;
      showToast('Record deleted.');
      loadCashflow();
    } catch (err) {
      showToast('Delete failed. ' + (err.message || ''), 'error');
    }
  });
}

/* ============================================================
   TAB 3 — HERD
   ============================================================ */
async function loadHerd() {
  try {
    const [{ data: goats, error: gErr }, { data: medical, error: mErr }] =
      await Promise.all([
        db.from('goats').select('*').order('tag_number', { ascending: true }),
        db.from('medical_history').select('*').order('treatment_date', { ascending: false })
      ]);

    if (gErr) throw gErr;
    if (mErr) throw mErr;

    allGoats = goats || [];

    /* Build goat_id → latest medical record */
    cachedMedMap = {};
    (medical || []).forEach(rec => {
      if (!cachedMedMap[rec.goat_id]) cachedMedMap[rec.goat_id] = rec;
    });

    /* Build goat_id → offspring count (appears as mother OR father) */
    cachedOffspring = {};
    allGoats.forEach(g => {
      if (g.mother_id) cachedOffspring[g.mother_id] = (cachedOffspring[g.mother_id] || 0) + 1;
      if (g.father_id) cachedOffspring[g.father_id] = (cachedOffspring[g.father_id] || 0) + 1;
    });

    renderGoatCards(allGoats);
    updateHerdStats(allGoats);
  } catch (err) {
    console.error('[Herd] Load error:', err);
    document.getElementById('goat-grid').innerHTML =
      '<div class="loading-state">⚠ Failed to load herd data.</div>';
    showToast('Failed to load herd data.', 'error');
  }
}

function renderGoatCards(goats) {
  const container = document.getElementById('goat-grid');

  /* Apply active filter */
  const filtered = currentFilter === 'ALL'
    ? goats
    : ['MALE', 'FEMALE'].includes(currentFilter)
    ? goats.filter(g => g.gender === currentFilter)
    : goats.filter(g => g.status === currentFilter);

  if (!filtered.length) {
    container.innerHTML = '<div class="loading-state">No goats match this filter.</div>';
    return;
  }

  container.innerHTML = filtered.map(goat => {
    const med       = cachedMedMap[goat.goat_id];
    const offspring = cachedOffspring[goat.goat_id] || 0;

    const genderBadge = goat.gender === 'MALE'
      ? '<span class="badge badge-male">♂ Male</span>'
      : '<span class="badge badge-female">♀ Female</span>';

    const statusBadge = goat.status === 'ACTIVE'
      ? '<span class="badge badge-active">Active</span>'
      : goat.status === 'SOLD'
      ? '<span class="badge badge-sold">Sold</span>'
      : '<span class="badge badge-deceased">Deceased</span>';

    /* Photo — safe src via escapeHtml; fallback placeholder on error */
    const photoHtml = goat.photo_url
      ? `<img class="goat-photo"
              src="${escapeHtml(goat.photo_url)}"
              alt="Goat ${escapeHtml(goat.tag_number)}"
              loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
         <div class="goat-photo-placeholder" style="display:none">🐐</div>`
      : `<div class="goat-photo-placeholder">🐐</div>`;

    const medHtml = med
      ? `<div class="goat-medical">
           🏥 <span class="goat-medical-title">${escapeHtml(med.title)}</span>
           &nbsp;·&nbsp; ${formatDate(med.treatment_date)}
         </div>`
      : `<div class="goat-medical">No medical records on file</div>`;

    return `
      <div class="goat-card">
        ${photoHtml}
        <div class="goat-card-body">
          <div class="goat-header">
            <span class="goat-tag">${escapeHtml(goat.tag_number)}</span>
            ${genderBadge}
          </div>
          <div class="goat-details">
            <div class="goat-detail-row">
              <span class="goat-detail-label">Breed</span>
              <span class="goat-detail-value">${escapeHtml(goat.breed || '—')}</span>
            </div>
            <div class="goat-detail-row">
              <span class="goat-detail-label">Age</span>
              <span class="goat-detail-value">${calculateAge(goat.birth_date)}</span>
            </div>
            <div class="goat-detail-row">
              <span class="goat-detail-label">Offspring</span>
              <span class="goat-detail-value">${offspring}</span>
            </div>
            <div class="goat-detail-row">
              <span class="goat-detail-label">Status</span>
              <span class="goat-detail-value">${statusBadge}</span>
            </div>
          </div>
          ${medHtml}
        </div>
        <div class="goat-card-actions">
          <button class="btn-icon btn-icon-edit"   onclick="openEditGoat('${escapeHtml(goat.goat_id)}')">&#9998; Edit</button>
          <button class="btn-icon btn-icon-danger" onclick="deleteGoatRow('${escapeHtml(goat.goat_id)}', '${escapeHtml(goat.tag_number)}', this)">✕ Delete</button>
        </div>
      </div>`;
  }).join('');
}

function updateHerdStats(goats) {
  document.getElementById('stat-total-goats').textContent  = goats.length;
  document.getElementById('stat-male-goats').textContent   = goats.filter(g => g.gender === 'MALE').length;
  document.getElementById('stat-female-goats').textContent = goats.filter(g => g.gender === 'FEMALE').length;
  document.getElementById('stat-active-goats').textContent = goats.filter(g => g.status === 'ACTIVE').length;
}

async function populateParentDropdowns() {
  const motherSel = document.getElementById('goat-mother');
  const fatherSel = document.getElementById('goat-father');

  motherSel.innerHTML = '<option value="">Loading…</option>';
  fatherSel.innerHTML = '<option value="">Loading…</option>';

  const { data, error } = await db
    .from('goats')
    .select('goat_id, tag_number, breed, gender')
    .eq('status', 'ACTIVE')
    .order('tag_number', { ascending: true });

  if (error) {
    motherSel.innerHTML = '<option value="">⚠ Failed to load</option>';
    fatherSel.innerHTML = '<option value="">⚠ Failed to load</option>';
    console.error('[Dropdown] Goats fetch error:', error);
    return;
  }

  /* Update global cache too */
  if (data && data.length) allGoats = data;

  const females = (data || []).filter(g => g.gender === 'FEMALE');
  const males   = (data || []).filter(g => g.gender === 'MALE');

  motherSel.innerHTML = '<option value="">None / Unknown</option>';
  females.forEach(g => {
    motherSel.innerHTML +=
      `<option value="${escapeHtml(g.goat_id)}">${escapeHtml(g.tag_number)} — ${escapeHtml(g.breed || 'Unknown')}</option>`;
  });

  fatherSel.innerHTML = '<option value="">None / Unknown</option>';
  males.forEach(g => {
    fatherSel.innerHTML +=
      `<option value="${escapeHtml(g.goat_id)}">${escapeHtml(g.tag_number)} — ${escapeHtml(g.breed || 'Unknown')}</option>`;
  });
}

async function submitRegisterGoat() {
  const tag       = document.getElementById('goat-tag').value.trim();
  const breed     = document.getElementById('goat-breed').value.trim();
  const gender    = document.getElementById('goat-gender').value;
  const birthdate = document.getElementById('goat-birthdate').value;
  const status    = document.getElementById('goat-status').value;
  const photoUrl  = document.getElementById('goat-photo').value.trim();
  const motherId  = document.getElementById('goat-mother').value || null;
  const fatherId  = document.getElementById('goat-father').value || null;

  if (!tag || !breed || !gender || !birthdate || !status) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }

  const btn = document.getElementById('btn-submit-goat');
  setLoading(btn, true);

  try {
    const payload = { tag_number: tag, breed, gender, birth_date: birthdate, status, mother_id: motherId, father_id: fatherId };
    if (photoUrl) payload.photo_url = photoUrl;

    if (editingGoatId) {
      const { error } = await db.from('goats').update(payload).eq('goat_id', editingGoatId);
      if (error) throw error;
      showToast(`Goat ${tag} updated!`);
    } else {
      const { error } = await db.from('goats').insert(payload);
      if (error) throw error;
      showToast(`Goat ${tag} registered successfully!`);
    }

    closeModal('modal-register-goat');
    loadHerd();
  } catch (err) {
    console.error('[Herd] Register/Update error:', err);
    showToast('Failed to save goat. ' + (err.message || ''), 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function openEditGoat(goatId) {
  const goat = allGoats.find(g => g.goat_id === goatId);
  if (!goat) return;
  editingGoatId = goatId;
  document.querySelector('#modal-register-goat .modal-header h3').textContent = 'Edit Goat';
  document.getElementById('btn-submit-goat').textContent = 'Save Changes';
  const modal = document.getElementById('modal-register-goat');
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  await populateParentDropdowns();
  document.getElementById('goat-tag').value       = goat.tag_number || '';
  document.getElementById('goat-breed').value     = goat.breed      || '';
  document.getElementById('goat-gender').value    = goat.gender     || '';
  document.getElementById('goat-birthdate').value = goat.birth_date ? goat.birth_date.split('T')[0] : '';
  document.getElementById('goat-status').value    = goat.status     || 'ACTIVE';
  document.getElementById('goat-photo').value     = goat.photo_url  || '';
  document.getElementById('goat-mother').value    = goat.mother_id  || '';
  document.getElementById('goat-father').value    = goat.father_id  || '';
}

async function deleteGoatRow(goatId, tag, btn) {
  requireConfirm(btn, async () => {
    try {
      const { error } = await db.from('goats').delete().eq('goat_id', goatId);
      if (error) throw error;
      showToast(`Goat ${tag} deleted.`);
      loadHerd();
    } catch (err) {
      showToast('Delete failed. ' + (err.message || ''), 'error');
    }
  });
}

/* ============================================================
   HERD FILTER BUTTONS
   ============================================================ */
function initHerdFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentFilter = this.dataset.filter;
      /* Re-render from cached data — no extra DB round-trip */
      renderGoatCards(allGoats);
    });
  });
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  initTabs();
  initHerdFilters();

  /* Load all tabs concurrently on startup */
  await Promise.all([
    loadInvestors(),
    loadCashflow(),
    loadHerd()
  ]);
}

document.addEventListener('DOMContentLoaded', init);