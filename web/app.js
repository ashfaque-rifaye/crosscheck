// Crosscheck SPA — audit, conflict-map visualizer, and live setup status.
"use strict";

const $ = (id) => document.getElementById(id);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

let lastReport = null;
let filter = { severity: "all", source: "all" };

const SEV = {
  high: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};
const SEV_BAR = { high: "bg-rose-500", medium: "bg-amber-500", low: "bg-sky-500" };
const SEV_HEX = { high: "#fb7185", medium: "#fbbf24", low: "#38bdf8" };
const EXAMPLES = ["password policy", "MFA requirement", "refund window", "uptime SLA", "API rate limit", "database restart"];

// --------------------------------------------------------------------------- //
// Header + setup status
// --------------------------------------------------------------------------- //
async function loadHealth() {
  try {
    const h = await (await fetch("/api/health")).json();
    const isFoundry = h.provider === "Foundry IQ";
    setBadge("provider-badge", `🔌 ${h.provider}`, isFoundry);
    const llm = { azure: "🧠 Azure OpenAI", openai: "🧠 OpenAI", offline: "🗂️ Offline (cached)" }[h.llm_mode] || h.llm_mode;
    setBadge("llm-badge", llm, h.llm_mode === "azure");
  } catch (e) {
    setBadge("provider-badge", "provider unavailable", false);
  }
}

function setBadge(id, text, accent) {
  const el = $(id);
  el.textContent = text;
  el.className = "px-2.5 py-1 rounded-full border " +
    (accent ? "border-violet-500/40 bg-violet-500/10 text-violet-200" : "border-slate-700 bg-slate-900 text-slate-300");
}

async function loadSetup() {
  let s;
  try { s = await (await fetch("/api/setup-status")).json(); }
  catch (e) { $("setup-overall").textContent = "Setup status unavailable."; return; }

  const overall = {
    "live-foundry": `✅ <span class="text-emerald-300">Live on Foundry IQ</span> — ${s.source_count} sources connected.`,
    "live-mock": `🟢 <span class="text-slate-100">Live reasoning</span> on the bundled corpus. Add Foundry IQ below to ground on a real knowledge base.`,
    "offline": `🗂️ <span class="text-slate-100">Offline demo</span> (cached report). Add a reasoning LLM to run live — see below.`,
  }[s.overall] || "";
  $("setup-overall").innerHTML = overall;

  const dot = (st) => st === "ok" ? "bg-emerald-400" : st === "todo" ? "bg-amber-400" : "bg-slate-500";
  $("setup-checks").innerHTML = (s.checks || []).map((c) => `
    <div class="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div class="flex items-center gap-2 mb-1">
        <span class="h-2 w-2 rounded-full ${dot(c.state)}"></span>
        <span class="text-xs font-semibold text-slate-200">${esc(c.label)}</span>
      </div>
      <div class="text-sm text-slate-100">${esc(c.value)}</div>
      <p class="text-[11px] text-slate-500 mt-1 leading-snug">${esc(c.hint)}</p>
    </div>`).join("");
  if (s.detail) {
    $("setup-checks").insertAdjacentHTML("beforeend",
      `<div class="sm:col-span-3 text-[11px] text-amber-300/80">${esc(s.detail)}</div>`);
  }
}

function renderExamples() {
  $("examples").innerHTML = `<span class="text-slate-500">Try:</span>` +
    EXAMPLES.map((e) => `<button class="ex px-2.5 py-1 rounded-full border border-slate-700 hover:border-violet-500 hover:text-violet-200 transition" data-q="${esc(e)}">${esc(e)}</button>`).join("");
  document.querySelectorAll(".ex").forEach((b) =>
    b.addEventListener("click", () => { $("query").value = b.dataset.q; runScan("topic"); }));
}

// --------------------------------------------------------------------------- //
// Scan
// --------------------------------------------------------------------------- //
async function runScan(mode) {
  const query = $("query").value.trim();
  if (mode === "topic" && !query) mode = "full-scan";

  setLoading(true);
  ["summary-section", "map"].forEach((id) => $(id).classList.add("hidden"));
  $("results").innerHTML = "";
  $("note").classList.add("hidden");

  try {
    const res = await fetch("/api/scan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, mode }),
    });
    const report = await res.json();
    lastReport = report;
    await animateTrace(report.trace || []);
    render(report);
  } catch (e) {
    $("note").textContent = "Request failed: " + e.message;
    $("note").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = $("run-btn");
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full spin align-middle"></span>` : "Run audit";
}

async function animateTrace(steps) {
  const sec = $("trace-section"), list = $("trace");
  sec.classList.remove("hidden");
  list.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = "fade-in flex items-start gap-3 text-sm";
    li.innerHTML = `<span class="trace-icon mt-0.5 h-4 w-4 border-2 border-violet-400/40 border-t-violet-400 rounded-full spin"></span>
      <span><span class="font-medium text-slate-200">${esc(s.step)}</span>
      <span class="text-slate-500">— ${esc(s.detail || "")}</span></span>`;
    list.appendChild(li);
    await delay(340);
    li.querySelector(".trace-icon").outerHTML = `<span class="mt-0.5 text-violet-400">✓</span>`;
  }
  await delay(120);
}

// --------------------------------------------------------------------------- //
// Render
// --------------------------------------------------------------------------- //
function render(report) {
  const s = report.summary || {};
  const sevBits = [];
  if (s.high) sevBits.push(`<span class="text-rose-300">${s.high} high</span>`);
  if (s.medium) sevBits.push(`<span class="text-amber-300">${s.medium} medium</span>`);
  if (s.low) sevBits.push(`<span class="text-sky-300">${s.low} low</span>`);
  $("summary-text").innerHTML =
    `Scanned <b class="text-slate-100">${s.sources_scanned || 0}</b> sources · ` +
    `<b class="text-slate-100">${s.conflicts_found || 0}</b> conflicts` +
    (sevBits.length ? " · " + sevBits.join(" · ") : "");
  $("summary-section").classList.remove("hidden");

  buildFilters(report.conflicts || []);
  applyFilters();

  if (report.note) { $("note").textContent = report.note; $("note").classList.remove("hidden"); }
  else $("note").classList.add("hidden");
}

function buildFilters(conflicts) {
  const sevs = ["all", "high", "medium", "low"];
  const sources = ["all", ...new Set(conflicts.flatMap((c) => [c.side_a.source_ref.source_name, c.side_b.source_ref.source_name]))];
  filter = { severity: "all", source: "all" };
  $("filters").innerHTML =
    sevs.map((v) => `<button class="fsev px-2.5 py-1 rounded-lg text-xs border ${v === "all" ? "border-violet-500 text-violet-200" : "border-slate-700 text-slate-400"}" data-v="${v}">${v}</button>`).join("") +
    `<select id="fsrc" class="ml-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 px-2 py-1">` +
    sources.map((s) => `<option value="${esc(s)}">${s === "all" ? "all sources" : esc(s)}</option>`).join("") + `</select>`;

  document.querySelectorAll(".fsev").forEach((b) =>
    b.addEventListener("click", () => {
      filter.severity = b.dataset.v;
      document.querySelectorAll(".fsev").forEach((x) => {
        const on = x.dataset.v === filter.severity;
        x.className = `fsev px-2.5 py-1 rounded-lg text-xs border ${on ? "border-violet-500 text-violet-200" : "border-slate-700 text-slate-400"}`;
      });
      applyFilters();
    }));
  $("fsrc").addEventListener("change", (e) => { filter.source = e.target.value; applyFilters(); });
}

function currentList() {
  const all = lastReport?.conflicts || [];
  return all.filter((c) => {
    if (filter.severity !== "all" && c.severity !== filter.severity) return false;
    if (filter.source !== "all") {
      const names = [c.side_a.source_ref.source_name, c.side_b.source_ref.source_name];
      if (!names.includes(filter.source)) return false;
    }
    return true;
  });
}

function applyFilters() {
  const list = currentList();
  renderGraph(list);
  renderConflicts(list);
}

// --------------------------------------------------------------------------- //
// Conflict-map visualizer (radial node-link, pure SVG)
// --------------------------------------------------------------------------- //
function renderGraph(conflicts) {
  const svg = $("graph");
  if (!conflicts.length) { $("map").classList.add("hidden"); svg.innerHTML = ""; return; }
  $("map").classList.remove("hidden");

  // nodes = participating sources
  const nodes = new Map();
  conflicts.forEach((c) => [c.side_a.source_ref, c.side_b.source_ref].forEach((r) => {
    const n = nodes.get(r.source_id) || { id: r.source_id, name: r.source_name, deg: 0 };
    n.deg++; nodes.set(r.source_id, n);
  }));
  const list = [...nodes.values()];
  const N = list.length;
  const cx = 320, cy = 225, R = 150;
  const pos = {};
  list.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a, n };
  });

  // pair bookkeeping so parallel chords don't overlap
  const pairTotals = {};
  conflicts.forEach((c) => {
    const k = [c.side_a.source_ref.source_id, c.side_b.source_ref.source_id].sort().join("|");
    pairTotals[k] = (pairTotals[k] || 0) + 1;
  });
  const pairSeen = {};

  const chords = conflicts.map((c) => {
    const A = pos[c.side_a.source_ref.source_id], B = pos[c.side_b.source_ref.source_id];
    const key = [c.side_a.source_ref.source_id, c.side_b.source_ref.source_id].sort().join("|");
    const idx = pairSeen[key] = (pairSeen[key] || 0); pairSeen[key]++;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    let cxx = mx + (cx - mx) * 0.58, cyy = my + (cy - my) * 0.58;
    const px = -(B.y - A.y), py = B.x - A.x, pl = Math.hypot(px, py) || 1;
    const off = (idx - (pairTotals[key] - 1) / 2) * 26;
    cxx += (px / pl) * off; cyy += (py / pl) * off;
    const w = 1.6 + (c.confidence || 0.5) * 2.8;
    return `<path class="chord" d="M${A.x.toFixed(1)},${A.y.toFixed(1)} Q${cxx.toFixed(1)},${cyy.toFixed(1)} ${B.x.toFixed(1)},${B.y.toFixed(1)}"
      stroke="${SEV_HEX[c.severity]}" stroke-width="${w.toFixed(1)}" opacity="0.55"
      data-cid="${esc(c.id)}"><title>${esc(c.title)}</title></path>`;
  }).join("");

  const nodeEls = list.map((n) => {
    const p = pos[n.id];
    const r = Math.min(11, 5 + n.deg * 1.2);
    const right = Math.cos(p.a) >= -0.2;
    const lx = p.x + Math.cos(p.a) * 16, ly = p.y + Math.sin(p.a) * 16;
    const anchor = right ? "start" : "end";
    const label = n.name.length > 22 ? n.name.slice(0, 21) + "…" : n.name;
    return `<g class="node">
      <circle class="node-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"
        fill="#0b1120" stroke="#64748b" stroke-width="1.5"><title>${esc(n.name)} · ${n.deg} conflict(s)</title></circle>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle"
        fill="#cbd5e1" font-size="11">${esc(label)}</text>
    </g>`;
  }).join("");

  svg.innerHTML = chords + nodeEls;

  // legend
  $("graph-legend").innerHTML = ["high", "medium", "low"].map((s) =>
    `<span class="inline-flex items-center gap-1"><span style="width:14px;height:3px;background:${SEV_HEX[s]};display:inline-block;border-radius:2px"></span>${s}</span>`).join("");

  // interactions
  svg.querySelectorAll(".chord").forEach((path) => {
    path.addEventListener("click", () => {
      const card = $("card-" + path.dataset.cid);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.remove("card-flash"); void card.offsetWidth; card.classList.add("card-flash");
      }
    });
    path.addEventListener("mouseenter", () => path.setAttribute("stroke-width", String(parseFloat(path.getAttribute("stroke-width")) + 2)));
    path.addEventListener("mouseleave", () => path.setAttribute("stroke-width", String(parseFloat(path.getAttribute("stroke-width")) - 2)));
  });
}

// --------------------------------------------------------------------------- //
// Conflict cards
// --------------------------------------------------------------------------- //
function citation(ref) {
  const bits = [ref.source_type, ref.locator ? "§ " + ref.locator : null, ref.version, ref.effective_date].filter(Boolean);
  return bits.map(esc).join(" · ");
}

function side(ref, statement, value) {
  const v = value ? `<span class="mono text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 whitespace-nowrap">${esc(value)}</span>` : "";
  return `<div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div class="flex items-start justify-between gap-2 mb-1.5">
        <span class="text-sm font-semibold text-slate-100">${esc(ref.source_name)}</span>${v}
      </div>
      <p class="text-sm text-slate-300 leading-snug">${esc(statement)}</p>
      <div class="mono text-[11px] text-slate-500 mt-2">${citation(ref)}</div>
    </div>`;
}

function renderConflicts(list) {
  const root = $("results");
  if (!list.length) { root.innerHTML = ""; return; }
  root.innerHTML = list.map((c) => {
    const sev = SEV[c.severity] || SEV.low;
    const conf = Math.round((c.confidence || 0) * 100);
    const res = c.suggested_resolution
      ? `<div class="mt-3 text-xs text-slate-400 border-t border-slate-800 pt-3">
           <span class="uppercase tracking-wider text-slate-500 mr-1">Suggested</span>
           <span class="text-slate-300">${esc(c.suggested_resolution)}</span>
           ${c.resolution_basis ? `<span class="text-slate-500"> — ${esc(c.resolution_basis)}</span>` : ""}
         </div>` : "";
    return `<article id="card-${esc(c.id)}" class="fade-in rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
        <header class="flex items-start justify-between gap-4 mb-2">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase border ${sev}">${esc(c.severity)}</span>
              <span class="px-2 py-0.5 rounded-md text-[11px] mono bg-slate-800 text-slate-400 border border-slate-700">${esc(c.type)}</span>
            </div>
            <h3 class="text-base font-semibold text-white leading-snug">${esc(c.title)}</h3>
          </div>
          <div class="shrink-0 w-28 text-right">
            <div class="text-[11px] text-slate-500 mb-1">confidence ${conf}%</div>
            <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="h-full ${SEV_BAR[c.severity] || "bg-slate-500"}" style="width:${conf}%"></div></div>
          </div>
        </header>
        ${c.explanation ? `<p class="text-sm text-slate-400 mb-3">${esc(c.explanation)}</p>` : ""}
        <div class="grid sm:grid-cols-2 gap-3">
          ${side(c.side_a.source_ref, c.side_a.statement, c.side_a.value)}
          ${side(c.side_b.source_ref, c.side_b.statement, c.side_b.value)}
        </div>
        ${res}
      </article>`;
  }).join("");
}

// --------------------------------------------------------------------------- //
$("run-btn").addEventListener("click", () => runScan("topic"));
$("scan-btn").addEventListener("click", () => runScan("full-scan"));
$("query").addEventListener("keydown", (e) => { if (e.key === "Enter") runScan("topic"); });
$("recheck").addEventListener("click", loadSetup);
renderExamples();
loadHealth();
loadSetup();
