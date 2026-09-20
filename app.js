/* =========================================================
   Fund Ledger — all data lives in this browser's localStorage.
   No server, no account, no network calls.
   ========================================================= */

const STORAGE_KEY = "fundledger.v1";

/** @type {{transactions: Array, navByFund: Object, schemeCodeByFund: Object}} */
let state = loadState();

/** Parsed nav.json (fetched fresh each load, never stored) */
let amfiNav = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.schemeCodeByFund) parsed.schemeCodeByFund = {};
      return parsed;
    }
  } catch (e) {
    console.error("Could not read saved data:", e);
  }
  return { transactions: [], navByFund: {}, schemeCodeByFund: {} };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------------------------------------------
   Auto NAV feed — nav.json is written by a scheduled GitHub
   Action (see .github/workflows/update-nav.yml) that pulls
   AMFI's daily NAV file server-side, sidestepping the browser
   CORS block that stops this app fetching amfiindia.com
   directly. This fetch is best-effort: if nav.json isn't
   there yet (Action not set up, or running from a local file),
   the app just falls back to manual NAV entry.
--------------------------------------------------------- */
async function loadAmfiNav() {
  try {
    const res = await fetch("nav.json?t=" + Date.now());
    if (!res.ok) return;
    amfiNav = await res.json();
    render();
  } catch (e) {
    // No nav.json yet (Action not set up, or opened as a local file) — that's fine.
  }
}

/* ---------------------------------------------------------
   Money-weighted annualised return (XIRR), Newton-Raphson
   with a bisection fallback so it never just throws up its
   hands on odd cash-flow patterns.
   cashflows: [{ amount: number, date: Date }]
--------------------------------------------------------- */
function computeXirr(cashflows) {
  if (cashflows.length < 2) return null;
  const hasPositive = cashflows.some(c => c.amount > 0);
  const hasNegative = cashflows.some(c => c.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const d0 = cashflows[0].date;
  const yearsFrac = (d) => (d - d0) / (1000 * 60 * 60 * 24 * 365);

  function npv(rate) {
    return cashflows.reduce((acc, cf) => acc + cf.amount / Math.pow(1 + rate, yearsFrac(cf.date)), 0);
  }
  function dnpv(rate) {
    return cashflows.reduce((acc, cf) => {
      const t = yearsFrac(cf.date);
      return acc - (t * cf.amount) / Math.pow(1 + rate, t + 1);
    }, 0);
  }

  let rate = 0.1;
  let converged = false;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate);
    const fp = dnpv(rate);
    if (Math.abs(fp) < 1e-12) break;
    let next = rate - f / fp;
    if (!isFinite(next)) break;
    if (next <= -0.999999) next = -0.999999;
    if (Math.abs(next - rate) < 1e-9) { rate = next; converged = true; break; }
    rate = next;
  }

  if (!converged || !isFinite(rate) || Math.abs(npv(rate)) > 1) {
    // Fallback: bisection over a wide, sane range.
    let lo = -0.999, hi = 10;
    let flo = npv(lo);
    let found = false;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const fmid = npv(mid);
      if (Math.abs(fmid) < 1e-6) { rate = mid; found = true; break; }
      if ((flo < 0) === (fmid < 0)) { lo = mid; flo = fmid; } else { hi = mid; }
    }
    if (!found) rate = (lo + hi) / 2;
  }
  return rate;
}

/* ---------------------------------------------------------
   Derived data from the raw transaction log
--------------------------------------------------------- */
function fundNames() {
  const names = new Set(state.transactions.map(t => t.fund));
  return Array.from(names).sort();
}

function autoNavFor(fund) {
  if (!amfiNav) return null;
  const code = state.schemeCodeByFund[fund];
  if (!code) return null;
  const entry = amfiNav[String(code).trim()];
  return entry ? { value: entry.nav, date: entry.date, name: entry.name } : null;
}

function statsForFund(fund) {
  const txns = state.transactions.filter(t => t.fund === fund);
  let units = 0, invested = 0;
  const cashflows = [];
  for (const t of txns) {
    const u = t.amount / t.nav;
    if (t.type === "investment") {
      units += u;
      invested += t.amount;
      cashflows.push({ amount: -t.amount, date: new Date(t.date) });
    } else {
      units -= u;
      invested -= t.amount;
      cashflows.push({ amount: t.amount, date: new Date(t.date) });
    }
  }

  const manualNav = state.navByFund[fund];
  const auto = autoNavFor(fund);
  const latestNav = manualNav != null ? manualNav : (auto ? auto.value : null);
  const navSource = manualNav != null ? "manual" : (auto ? "auto" : null);
  const navDate = navSource === "auto" ? auto.date : null;

  const currentValue = latestNav != null ? units * latestNav : null;
  const gain = currentValue != null ? currentValue - invested : null;
  const returnPct = currentValue != null && invested !== 0 ? gain / invested : null;

  let cagr = null;
  if (currentValue != null) {
    const cfs = cashflows.concat([{ amount: currentValue, date: new Date() }]);
    cagr = computeXirr(cfs);
  }
  return {
    fund, units, invested, latestNav, currentValue, gain, returnPct, cagr,
    schemeCode: state.schemeCodeByFund[fund] || "",
    navSource, navDate, autoAvailable: auto != null,
  };
}

function portfolioStats() {
  const funds = fundNames().map(statsForFund);
  const invested = funds.reduce((a, f) => a + f.invested, 0);
  const knownValueFunds = funds.filter(f => f.currentValue != null);
  const currentValue = knownValueFunds.reduce((a, f) => a + f.currentValue, 0);
  const gain = knownValueFunds.length ? currentValue - knownValueFunds.reduce((a, f) => a + f.invested, 0) : null;

  const allCashflows = [];
  for (const t of state.transactions) {
    allCashflows.push({
      amount: t.type === "investment" ? -t.amount : t.amount,
      date: new Date(t.date),
    });
  }
  let cagr = null;
  if (knownValueFunds.length === funds.length && funds.length > 0) {
    cagr = computeXirr(allCashflows.concat([{ amount: currentValue, date: new Date() }]));
  }
  return { funds, invested, currentValue: knownValueFunds.length ? currentValue : null, gain, cagr };
}

/* ---------------------------------------------------------
   Formatting helpers
--------------------------------------------------------- */
const inr = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (n) => n == null ? "—" : (n * 100).toFixed(2) + "%";
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/* ---------------------------------------------------------
   Rendering
--------------------------------------------------------- */
function render() {
  renderSummary();
  renderLedger();
  renderHoldings();
  renderFundDatalist();
  saveState();
}

function renderSummary() {
  const p = portfolioStats();
  document.getElementById("sumInvested").textContent = inr(p.invested);
  document.getElementById("sumCurrent").textContent = inr(p.currentValue);
  const gainEl = document.getElementById("sumGain");
  gainEl.textContent = inr(p.gain);
  gainEl.className = "summary-value" + (p.gain > 0 ? " gain" : p.gain < 0 ? " loss" : "");
  document.getElementById("sumCagr").textContent = p.cagr == null ? "—" : pct(p.cagr);
}

function renderLedger() {
  const body = document.getElementById("ledgerBody");
  const empty = document.getElementById("ledgerEmpty");
  const rows = [...state.transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  body.innerHTML = "";
  empty.style.display = rows.length ? "none" : "block";

  for (const t of rows) {
    const units = t.amount / t.nav;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(t.date)}</td>
      <td class="fund-cell">${escapeHtml(t.fund)}</td>
      <td><span class="type-pill ${t.type}">${t.type === "investment" ? "Buy" : "Sell"}</span></td>
      <td class="num">${inr(t.amount)}</td>
      <td class="num">${t.nav}</td>
      <td class="num">${units.toFixed(3)}</td>
      <td><button class="row-delete" data-id="${t.id}" aria-label="Delete">×</button></td>
    `;
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".row-delete")) return;
      openForm(t);
    });
    tr.querySelector(".row-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this entry?")) {
        state.transactions = state.transactions.filter(x => x.id !== t.id);
        render();
      }
    });
    body.appendChild(tr);
  }
}

function renderHoldings() {
  const body = document.getElementById("holdingsBody");
  const foot = document.getElementById("holdingsFoot");
  const empty = document.getElementById("holdingsEmpty");
  const p = portfolioStats();
  body.innerHTML = "";
  empty.style.display = p.funds.length ? "none" : "block";

  for (const f of p.funds) {
    const tr = document.createElement("tr");
    let navMeta = "";
    if (f.navSource === "auto") {
      navMeta = `<div class="nav-meta auto">Auto · ${escapeHtml(f.navDate || "")}</div>`;
    } else if (f.navSource === "manual" && f.autoAvailable) {
      navMeta = `<div class="nav-meta manual">Manual <button class="nav-reset" data-fund="${escapeHtml(f.fund)}" type="button">Use auto</button></div>`;
    } else if (f.schemeCode && !f.autoAvailable) {
      navMeta = `<div class="nav-meta missing">Not found yet</div>`;
    }
    tr.innerHTML = `
      <td class="fund-cell">${escapeHtml(f.fund)}</td>
      <td class="num"><input class="scheme-input" type="text" inputmode="numeric"
            data-fund="${escapeHtml(f.fund)}" value="${escapeHtml(f.schemeCode)}" placeholder="Scheme code"></td>
      <td class="num">
        <input class="nav-input" type="number" step="0.0001" min="0"
              data-fund="${escapeHtml(f.fund)}" value="${f.latestNav ?? ""}" placeholder="—">
        ${navMeta}
      </td>
      <td class="num">${f.units.toFixed(3)}</td>
      <td class="num">${inr(f.invested)}</td>
      <td class="num">${inr(f.currentValue)}</td>
      <td class="num">${inr(f.gain)}</td>
      <td class="num">${pct(f.returnPct)}</td>
      <td class="num">${pct(f.cagr)}</td>
    `;
    body.appendChild(tr);
  }

  document.querySelectorAll(".scheme-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const fund = e.target.dataset.fund;
      const val = e.target.value.trim();
      if (val) state.schemeCodeByFund[fund] = val;
      else delete state.schemeCodeByFund[fund];
      render();
    });
  });

  document.querySelectorAll(".nav-input").forEach(input => {
    input.addEventListener("change", (e) => {
      const fund = e.target.dataset.fund;
      const val = parseFloat(e.target.value);
      if (isFinite(val) && val > 0) {
        state.navByFund[fund] = val;
      } else {
        delete state.navByFund[fund];
      }
      render();
    });
  });

  document.querySelectorAll(".nav-reset").forEach(btn => {
    btn.addEventListener("click", () => {
      delete state.navByFund[btn.dataset.fund];
      render();
    });
  });

  if (p.funds.length) {
    foot.innerHTML = `
      <tr>
        <td>Portfolio total</td>
        <td></td>
        <td></td>
        <td></td>
        <td class="num">${inr(p.invested)}</td>
        <td class="num">${inr(p.currentValue)}</td>
        <td class="num">${inr(p.gain)}</td>
        <td class="num">${pct(p.currentValue != null ? p.gain / p.invested : null)}</td>
        <td class="num">${pct(p.cagr)}</td>
      </tr>
    `;
  } else {
    foot.innerHTML = "";
  }
}

function renderFundDatalist() {
  const dl = document.getElementById("fundNames");
  dl.innerHTML = fundNames().map(f => `<option value="${escapeHtml(f)}">`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------------------------------------------------
   Tabs
--------------------------------------------------------- */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById("view-" + btn.dataset.tab).classList.add("active");
  });
});

/* ---------------------------------------------------------
   Add / edit entry sheet
--------------------------------------------------------- */
const sheet = document.getElementById("entrySheet");
const backdrop = document.getElementById("sheetBackdrop");
const form = document.getElementById("entryForm");
const typeToggle = document.getElementById("fType");
let currentType = "investment";

function openForm(txn) {
  document.getElementById("sheetTitle").textContent = txn ? "Edit entry" : "Add entry";
  document.getElementById("deleteEntryBtn").hidden = !txn;
  document.getElementById("entryId").value = txn ? txn.id : "";
  document.getElementById("fDate").value = txn ? txn.date : new Date().toISOString().slice(0, 10);
  document.getElementById("fFund").value = txn ? txn.fund : "";
  document.getElementById("fAmount").value = txn ? txn.amount : "";
  document.getElementById("fNav").value = txn ? txn.nav : "";
  setType(txn ? txn.type : "investment");
  sheet.classList.add("open");
  backdrop.classList.add("open");
}

function closeForm() {
  sheet.classList.remove("open");
  backdrop.classList.remove("open");
  form.reset();
}

function setType(type) {
  currentType = type;
  typeToggle.querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.value === type));
}

typeToggle.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => setType(b.dataset.value)));

document.getElementById("openFormBtn").addEventListener("click", () => openForm(null));
document.getElementById("cancelFormBtn").addEventListener("click", closeForm);
backdrop.addEventListener("click", closeForm);

document.getElementById("deleteEntryBtn").addEventListener("click", () => {
  const id = document.getElementById("entryId").value;
  if (id && confirm("Delete this entry?")) {
    state.transactions = state.transactions.filter(x => x.id !== id);
    render();
    closeForm();
  }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = document.getElementById("entryId").value;
  const entry = {
    id: id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    date: document.getElementById("fDate").value,
    fund: document.getElementById("fFund").value.trim(),
    type: currentType,
    amount: parseFloat(document.getElementById("fAmount").value),
    nav: parseFloat(document.getElementById("fNav").value),
  };
  if (!entry.fund || !isFinite(entry.amount) || !isFinite(entry.nav) || entry.amount <= 0 || entry.nav <= 0) {
    alert("Please fill in every field with a positive number.");
    return;
  }
  if (id) {
    state.transactions = state.transactions.map(x => x.id === id ? entry : x);
  } else {
    state.transactions.push(entry);
  }
  render();
  closeForm();
});

/* ---------------------------------------------------------
   Backup: export / import
--------------------------------------------------------- */
document.getElementById("exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `fund-ledger-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.transactions)) throw new Error("Not a valid backup file");
      if (!confirm("This will replace everything currently in the app with the backup file. Continue?")) return;
      state = {
        transactions: parsed.transactions,
        navByFund: parsed.navByFund || {},
        schemeCodeByFund: parsed.schemeCodeByFund || {},
      };
      render();
    } catch (err) {
      alert("Couldn't read that file — is it a Fund Ledger backup .json?");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

/* ---------------------------------------------------------
   Boot
--------------------------------------------------------- */
render();
loadAmfiNav();
