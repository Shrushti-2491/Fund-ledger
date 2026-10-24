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
      return migrate(parsed);
    }
  } catch (e) {
    console.error("Could not read saved data:", e);
  }
  return migrate({});
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
   Family data model: every record has an owner. Market
   records (mutual fund / stock) are buys & sells with a mode
   (SIP / lump sum) and, for funds, a plan (Direct / Regular).
   FDs are stored separately in state.fds.
--------------------------------------------------------- */
const el = (id) => document.getElementById(id);
const ASSET = { mf: "Mutual fund", stock: "Stock", fd: "FD" };
const MODE = { sip: "SIP", lumpsum: "Lump sum", "": "Not set" };
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : "Not set";
const filt = { owner: "", asset: "", mode: "", plan: "" };
let currentAsset = "mf", lastOwner = "Me";

function migrate(s) {
  s.transactions = (s.transactions || []).map(t => Object.assign({ asset: "mf", owner: "Me", mode: "", plan: "direct" }, t));
  s.fds = s.fds || [];
  s.navByFund = s.navByFund || {};
  s.schemeCodeByFund = s.schemeCodeByFund || {};
  return s;
}

const owners = () => [...new Set([...state.transactions, ...state.fds].map(x => x.owner))].sort();
const fundNames = () => [...new Set(state.transactions.map(t => t.fund))].sort();

function autoNavFor(fund) {
  if (!amfiNav) return null;
  const code = state.schemeCodeByFund[fund];
  const entry = code ? amfiNav[String(code).trim()] : null;
  return entry ? { value: entry.nav, date: entry.date, name: entry.name } : null;
}
function latestNavFor(fund) {
  const m = state.navByFund[fund];
  if (m != null) return m;
  const a = autoNavFor(fund);
  return a ? a.value : null;
}
// AMFI's official scheme name wins over the tag, so a wrong tag can't mislead you.
function planFor(t) {
  if (t.asset !== "mf") return "";
  const a = autoNavFor(t.fund);
  const n = a && a.name ? a.name.toLowerCase() : "";
  return n.includes("direct") ? "direct" : n.includes("regular") ? "regular" : t.plan;
}

function fdValue(fd, on = new Date()) {
  const d = on < new Date(fd.maturity) ? on : new Date(fd.maturity);
  const yrs = Math.max(0, (d - new Date(fd.start)) / 31536000000);
  const n = { monthly: 12, quarterly: 4, yearly: 1 }[fd.comp];
  const r = fd.rate / 100;
  return n ? fd.principal * Math.pow(1 + r / n, n * yrs) : fd.principal * (1 + r * yrs);
}

// One "lot" per transaction / FD, so any grouping (person, asset, mode, plan) is just a filter.
function allLots() {
  const lots = [];
  for (const t of state.transactions) {
    const buy = t.type === "investment", u = t.amount / t.nav;
    lots.push({ owner: t.owner, asset: t.asset, mode: t.mode, plan: planFor(t), fund: t.fund,
                date: t.date, cash: buy ? t.amount : -t.amount, units: buy ? u : -u });
  }
  for (const f of state.fds) {
    lots.push({ owner: f.owner, asset: "fd", mode: "", plan: "", fund: f.name, date: f.start,
                cash: f.principal, fd: f, value: fdValue(f),
                endDate: new Date(f.maturity) <= new Date() ? f.maturity : null });
  }
  return lots;
}
const passes = (l) => (!filt.owner || l.owner === filt.owner) && (!filt.asset || l.asset === filt.asset)
  && (!filt.mode || l.mode === filt.mode) && (!filt.plan || l.plan === filt.plan);
const lotValue = (l) => {
  if (l.fd) return l.value;
  const nav = latestNavFor(l.fund);
  return nav != null ? l.units * nav : null;
};

function summarize(lots) {
  let invested = 0, value = 0, complete = lots.length > 0;
  const cfs = [];
  for (const l of lots) {
    invested += l.cash;
    cfs.push({ amount: -l.cash, date: new Date(l.date) });
    const v = lotValue(l);
    if (v == null) { complete = false; continue; }
    value += v;
    cfs.push({ amount: v, date: l.endDate ? new Date(l.endDate) : new Date() });
  }
  return {
    invested, value: complete ? value : null,
    gain: complete ? value - invested : null,
    ret: complete && invested ? (value - invested) / invested : null,
    cagr: complete ? computeXirr(cfs) : null,
  };
}

/* Formatting */
const inr = (n) => n == null ? "—" : "₹" + Math.round(n).toLocaleString("en-IN");
const pct = (n) => n == null ? "—" : (n * 100).toFixed(2) + "%";
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sub = (asset, mode, plan) => `<div class="sub">${ASSET[asset]}${asset !== "fd" ? " · " + MODE[mode] : ""}${plan ? " · " + cap(plan) : ""}</div>`;
const gainCls = (n) => n > 0 ? "gain" : n < 0 ? "loss" : "";

/* Rendering */
function render() {
  if (filt.owner && !owners().includes(filt.owner)) filt.owner = "";
  const lots = allLots().filter(passes);
  renderFilters(); renderSummary(lots); renderFamily(lots); renderLedger(); renderHoldings(lots); renderDatalists();
  saveState();
}

function renderFilters() {
  el("fltOwner").innerHTML = '<option value="">Everyone</option>' +
    owners().map(o => `<option value="${escapeHtml(o)}"${o === filt.owner ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");
}

function renderSummary(lots) {
  const s = summarize(lots);
  el("sumInvested").textContent = inr(s.invested);
  el("sumCurrent").textContent = inr(s.value);
  el("sumGain").textContent = inr(s.gain);
  el("sumGain").className = "summary-value " + gainCls(s.gain);
  el("sumCagr").textContent = pct(s.cagr);
}

function groupTable(title, head, lots, keyFn, labelFn) {
  const g = new Map();
  for (const l of lots) { const k = keyFn(l); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(l); }
  if (!g.size) return "";
  const rows = [...g].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, ls]) => {
    const s = summarize(ls);
    return `<tr><td class="fund-cell">${labelFn(k)}</td><td class="num">${inr(s.invested)}</td><td class="num">${inr(s.value)}</td><td class="num">${inr(s.gain)}</td><td class="num">${pct(s.cagr)}</td></tr>`;
  }).join("");
  return `<h3 class="group-title">${title}</h3><div class="table-wrap"><table class="holdings-table"><thead><tr><th>${head}</th><th class="num">Invested</th><th class="num">Value</th><th class="num">Gain</th><th class="num">CAGR</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderFamily(lots) {
  const out = el("familyOut");
  if (!lots.length) { out.innerHTML = '<p class="empty-state" style="display:block">Add an entry to see the breakdown by person, asset, SIP and plan.</p>'; return; }
  out.innerHTML =
    groupTable("By person", "Person", lots, l => l.owner, k => `${escapeHtml(k)} <button class="link-btn" data-rename="${escapeHtml(k)}" type="button">rename</button>`) +
    groupTable("By asset type", "Asset", lots, l => l.asset, k => ASSET[k]) +
    groupTable("SIP vs lump sum", "How invested", lots, l => l.asset === "fd" ? null : l.mode, k => MODE[k]) +
    groupTable("Direct vs Regular", "Plan", lots, l => l.asset === "mf" ? l.plan : null, k => cap(k));
  out.querySelectorAll("[data-rename]").forEach(b => b.addEventListener("click", () => renameOwner(b.dataset.rename)));
}

function renameOwner(old) {
  const nu = (prompt(`Rename "${old}" to:`, old) || "").trim();
  if (!nu || nu === old) return;
  [...state.transactions, ...state.fds].forEach(x => { if (x.owner === old) x.owner = nu; });
  if (filt.owner === old) filt.owner = nu;
  render();
}

function deleteById(id) {
  state.transactions = state.transactions.filter(x => x.id !== id);
  state.fds = state.fds.filter(x => x.id !== id);
}

function renderLedger() {
  const rows = [
    ...state.transactions.map(t => ({ t, date: t.date, key: { owner: t.owner, asset: t.asset, mode: t.mode, plan: planFor(t) } })),
    ...state.fds.map(f => ({ f, date: f.start, key: { owner: f.owner, asset: "fd", mode: "", plan: "" } })),
  ].filter(r => passes(r.key)).sort((a, b) => new Date(b.date) - new Date(a.date));
  const body = el("ledgerBody");
  body.innerHTML = "";
  el("ledgerEmpty").style.display = rows.length ? "none" : "block";
  for (const r of rows) {
    const tr = document.createElement("tr");
    const x = r.t || r.f;
    tr.innerHTML = r.t ? `
      <td>${fmtDate(r.date)}</td><td>${escapeHtml(x.owner)}</td>
      <td class="fund-cell">${escapeHtml(x.fund)}${sub(x.asset, x.mode, r.key.plan)}</td>
      <td><span class="type-pill ${x.type}">${x.type === "investment" ? "Buy" : "Sell"}</span></td>
      <td class="num">${inr(x.amount)}</td><td class="num">${x.nav}</td><td class="num">${(x.amount / x.nav).toFixed(3)}</td>
      <td><button class="row-delete" aria-label="Delete">×</button></td>` : `
      <td>${fmtDate(r.date)}</td><td>${escapeHtml(x.owner)}</td>
      <td class="fund-cell">${escapeHtml(x.name)}${sub("fd", "", "")}</td>
      <td><span class="type-pill investment">FD</span></td>
      <td class="num">${inr(x.principal)}</td><td class="num">${x.rate}%</td><td class="num">—</td>
      <td><button class="row-delete" aria-label="Delete">×</button></td>`;
    tr.addEventListener("click", () => openForm(x, r.f ? "fd" : "txn"));
    tr.querySelector(".row-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Delete this entry?")) { deleteById(x.id); render(); }
    });
    body.appendChild(tr);
  }
}

function renderHoldings(lots) {
  const pos = new Map();
  for (const l of lots.filter(l => l.asset !== "fd")) {
    const k = [l.owner, l.asset, l.fund].join("|");
    if (!pos.has(k)) pos.set(k, []);
    pos.get(k).push(l);
  }
  const body = el("holdingsBody");
  body.innerHTML = "";
  for (const ls of pos.values()) {
    const { owner, asset, fund, plan } = ls[0];
    const s = summarize(ls), units = ls.reduce((a, l) => a + l.units, 0);
    const modes = [...new Set(ls.map(l => MODE[l.mode]))].join(" + ");
    const manual = state.navByFund[fund], auto = autoNavFor(fund);
    const latest = latestNavFor(fund), code = state.schemeCodeByFund[fund] || "";
    let meta = "";
    if (manual == null && auto) meta = `<div class="nav-meta auto">Auto · ${escapeHtml(auto.date || "")}</div>`;
    else if (manual != null && auto) meta = `<div class="nav-meta manual">Manual <button class="nav-reset" data-fund="${escapeHtml(fund)}" type="button">Use auto</button></div>`;
    else if (asset === "mf" && code && !auto) meta = '<div class="nav-meta missing">Not found yet</div>';
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(owner)}</td>
      <td class="fund-cell">${escapeHtml(fund)}<div class="sub">${ASSET[asset]} · ${modes}${plan ? " · " + cap(plan) : ""}</div></td>
      <td class="num">${asset === "mf" ? `<input class="scheme-input" type="text" inputmode="numeric" data-fund="${escapeHtml(fund)}" value="${escapeHtml(code)}" placeholder="Scheme code">` : "—"}</td>
      <td class="num"><input class="nav-input" type="number" step="0.0001" min="0" data-fund="${escapeHtml(fund)}" value="${latest ?? ""}" placeholder="${asset === "stock" ? "Price" : "—"}">${meta}</td>
      <td class="num">${units.toFixed(3)}</td><td class="num">${inr(s.invested)}</td><td class="num">${inr(s.value)}</td>
      <td class="num">${inr(s.gain)}</td><td class="num">${pct(s.ret)}</td><td class="num">${pct(s.cagr)}</td>`;
    body.appendChild(tr);
  }
  body.querySelectorAll(".scheme-input").forEach(i => i.addEventListener("change", (e) => {
    const v = e.target.value.trim(), f = e.target.dataset.fund;
    if (v) state.schemeCodeByFund[f] = v; else delete state.schemeCodeByFund[f];
    render();
  }));
  body.querySelectorAll(".nav-input").forEach(i => i.addEventListener("change", (e) => {
    const v = parseFloat(e.target.value), f = e.target.dataset.fund;
    if (isFinite(v) && v > 0) state.navByFund[f] = v; else delete state.navByFund[f];
    render();
  }));
  body.querySelectorAll(".nav-reset").forEach(b => b.addEventListener("click", () => { delete state.navByFund[b.dataset.fund]; render(); }));

  const fds = lots.filter(l => l.asset === "fd");
  el("fdSection").hidden = !fds.length;
  el("fdBody").innerHTML = "";
  for (const l of fds) {
    const f = l.fd, s = summarize([l]), tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(f.owner)}</td><td class="fund-cell">${escapeHtml(f.name)}${l.endDate ? '<div class="sub">Matured</div>' : ""}</td>
      <td class="num">${inr(f.principal)}</td><td class="num">${f.rate}%</td><td class="num">${fmtDate(f.maturity)}</td>
      <td class="num">${inr(s.value)}</td><td class="num">${inr(s.gain)}</td><td class="num">${pct(s.cagr)}</td>`;
    tr.addEventListener("click", () => openForm(f, "fd"));
    el("fdBody").appendChild(tr);
  }
  el("holdingsEmpty").style.display = lots.length ? "none" : "block";
  const t = summarize(lots);
  el("holdingsFoot").innerHTML = lots.length ? `<tr><td>Total</td><td></td><td></td><td></td><td></td>
    <td class="num">${inr(t.invested)}</td><td class="num">${inr(t.value)}</td><td class="num">${inr(t.gain)}</td>
    <td class="num">${pct(t.ret)}</td><td class="num">${pct(t.cagr)}</td></tr>` : "";
}

function renderDatalists() {
  el("fundNames").innerHTML = fundNames().map(f => `<option value="${escapeHtml(f)}">`).join("");
  el("ownerNames").innerHTML = owners().map(o => `<option value="${escapeHtml(o)}">`).join("");
}

/* Filters & tabs */
["Owner", "Asset", "Mode", "Plan"].forEach(n => el("flt" + n).addEventListener("change", (e) => { filt[n.toLowerCase()] = e.target.value; render(); }));
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  btn.classList.add("active"); btn.setAttribute("aria-selected", "true");
  el("view-" + btn.dataset.tab).classList.add("active");
}));

/* Add / edit sheet */
const sheet = el("entrySheet"), backdrop = el("sheetBackdrop"), form = el("entryForm");
const segValue = (id) => el(id).querySelector(".seg-btn.active").dataset.value;
const setSeg = (id, v) => el(id).querySelectorAll(".seg-btn").forEach(b => b.classList.toggle("active", b.dataset.value === v));
document.querySelectorAll(".segmented").forEach(g => g.querySelectorAll(".seg-btn").forEach(b => b.addEventListener("click", () => {
  if (g.id === "fAsset") setAsset(b.dataset.value); else setSeg(g.id, b.dataset.value);
})));

function setAsset(a) {
  currentAsset = a;
  setSeg("fAsset", a);
  el("mktFields").hidden = a === "fd";
  el("fdFields").hidden = a !== "fd";
  el("planWrap").hidden = a !== "mf";
  document.querySelector('label[for="fFund"]').textContent = a === "stock" ? "Stock name" : "Fund name";
  document.querySelector('label[for="fNav"]').textContent = a === "stock" ? "Price per share (₹)" : "NAV per unit (₹)";
}

function openForm(item, kind) {
  const isFd = kind === "fd", m = item && !isFd ? item : null, today = new Date().toISOString().slice(0, 10);
  el("sheetTitle").textContent = item ? "Edit entry" : "Add entry";
  el("deleteEntryBtn").hidden = !item;
  el("entryId").value = item ? item.id : "";
  el("fOwner").value = item ? item.owner : (filt.owner || lastOwner);
  setAsset(item ? (isFd ? "fd" : item.asset) : "mf");
  el("fDate").value = m ? m.date : today;
  el("fFund").value = m ? m.fund : "";
  el("fAmount").value = m ? m.amount : "";
  el("fNav").value = m ? m.nav : "";
  setSeg("fType", m ? m.type : "investment");
  setSeg("fMode", m && m.mode ? m.mode : "sip");
  setSeg("fPlan", m && m.plan ? m.plan : "direct");
  el("fdName").value = isFd ? item.name : "";
  el("fdPrincipal").value = isFd ? item.principal : "";
  el("fdRate").value = isFd ? item.rate : "";
  el("fdStart").value = isFd ? item.start : today;
  el("fdMaturity").value = isFd ? item.maturity : "";
  el("fdComp").value = isFd ? item.comp : "quarterly";
  sheet.classList.add("open"); backdrop.classList.add("open");
}
function closeForm() { sheet.classList.remove("open"); backdrop.classList.remove("open"); form.reset(); }

el("openFormBtn").addEventListener("click", () => openForm(null));
el("cancelFormBtn").addEventListener("click", closeForm);
backdrop.addEventListener("click", closeForm);
el("deleteEntryBtn").addEventListener("click", () => {
  const id = el("entryId").value;
  if (id && confirm("Delete this entry?")) { deleteById(id); render(); closeForm(); }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = el("entryId").value || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const owner = el("fOwner").value.trim(), num = (i) => parseFloat(el(i).value);
  let rec, ok, list;
  if (currentAsset === "fd") {
    rec = { id, owner, name: el("fdName").value.trim(), principal: num("fdPrincipal"), rate: num("fdRate"),
            start: el("fdStart").value, maturity: el("fdMaturity").value, comp: el("fdComp").value };
    ok = owner && rec.name && rec.principal > 0 && rec.rate >= 0 && rec.start && rec.maturity > rec.start;
    list = "fds";
  } else {
    rec = { id, owner, asset: currentAsset, date: el("fDate").value, fund: el("fFund").value.trim(), type: segValue("fType"),
            amount: num("fAmount"), nav: num("fNav"), mode: segValue("fMode"), plan: currentAsset === "mf" ? segValue("fPlan") : "" };
    ok = owner && rec.fund && rec.date && rec.amount > 0 && rec.nav > 0;
    list = "transactions";
  }
  if (!ok) { alert("Please fill in every field (FD maturity must be after the start date)."); return; }
  deleteById(id);
  state[list].push(rec);
  lastOwner = owner;
  render(); closeForm();
});

/* Backup */
el("exportBtn").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = `fund-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  URL.revokeObjectURL(url);
});
el("importInput").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.transactions)) throw new Error("bad");
      if (!confirm("This will replace everything currently in the app with the backup file. Continue?")) return;
      state = migrate(parsed); render();
    } catch (err) { alert("Couldn't read that file — is it a Fund Ledger backup .json?"); }
  };
  reader.readAsText(file);
  e.target.value = "";
});

render();
loadAmfiNav();
