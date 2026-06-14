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

// Severity → Tailwind classes and graph colours
const SEV_CLASS = {
  critical: "sev-critical",
  high:     "sev-high",
  medium:   "sev-medium",
  low:      "sev-low",
};
const SEV_BAR = {
  critical: "bg-red-500",
  high:     "bg-orange-500",
  medium:   "bg-yellow-400",
  low:      "bg-sky-500",
};
const SEV_HEX = {
  critical: "#ef4444",
  high:     "#f97316",
  medium:   "#eab308",
  low:      "#0ea5e9",
};

const EXAMPLES = [
  "password policy",
  "MFA requirement",
  "refund window",
  "uptime SLA",
  "API rate limit",
  "database restart",
];

// Inline SVG icons (no emojis)
const ICON = {
  check: `<svg class="w-3.5 h-3.5 trace-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  spinner: `<svg class="w-4 h-4 spin text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
  play: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`,
  dot_ok:   `<span class="inline-block h-2 w-2 rounded-full bg-emerald-400 shrink-0"></span>`,
  dot_todo: `<span class="inline-block h-2 w-2 rounded-full bg-amber-400 shrink-0"></span>`,
  dot_off:  `<span class="inline-block h-2 w-2 rounded-full bg-slate-600 shrink-0"></span>`,
};

// --------------------------------------------------------------------------
// Header / status badges
// --------------------------------------------------------------------------
async function loadHealth() {
  try {
    const h = await (await fetch("/api/health")).json();
    const isFoundry = h.provider === "Foundry IQ";
    const providerIcon = isFoundry
      ? `<svg class="w-3 h-3 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.99 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 14.92z"/></svg>`
      : `<svg class="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

    const llmLabels = {
      azure:   "Azure OpenAI",
      openai:  "OpenAI",
      offline: "Offline (cached)",
    };
    const llmLabel = llmLabels[h.llm_mode] || h.llm_mode;
    const llmLive = h.llm_mode !== "offline";

    setBadge("provider-badge", h.provider, isFoundry, providerIcon);
    setBadge("llm-badge", llmLabel, llmLive, llmLive
      ? `<svg class="w-3 h-3 text-sky-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 8v4l3 3"/></svg>`
      : `<svg class="w-3 h-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>`
    );
  } catch {
    setBadge("provider-badge", "unavailable", false, "");
  }
}

function setBadge(id, text, accent, iconHtml) {
  const el = $(id);
  el.innerHTML = `
    ${iconHtml}
    <span>${esc(text)}</span>
  `;
  el.className = "px-2.5 py-1 rounded-full border flex items-center gap-1.5 text-xs transition-colors " +
    (accent
      ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
      : "border-slate-700 bg-slate-900/80 text-slate-400");
}

async function loadSetup() {
  let s;
  try { s = await (await fetch("/api/setup-status")).json(); }
  catch { $("setup-overall").textContent = "Setup status unavailable."; return; }

  const overallMap = {
    "live-foundry": `<span class="text-emerald-400 font-medium">Live on Foundry IQ</span> — ${s.source_count} sources connected.`,
    "live-mock":    `<span class="text-slate-200 font-medium">Live reasoning</span> on the bundled corpus. Connect Foundry IQ below for real knowledge-base grounding.`,
    "offline":      `<span class="text-slate-200 font-medium">Offline demo</span> (cached report). Add a reasoning LLM to run live.`,
  };
  $("setup-overall").innerHTML = overallMap[s.overall] || "";

  const dotIcon = (st) => st === "ok" ? ICON.dot_ok : st === "todo" ? ICON.dot_todo : ICON.dot_off;

  $("setup-checks").innerHTML = (s.checks || []).map((c) => `
    <div class="rounded-xl border border-slate-800/60 bg-[#040d1a]/60 p-3 hover:border-sky-900/40 transition-colors">
      <div class="flex items-center gap-2 mb-1">
        ${dotIcon(c.state)}
        <span class="text-xs font-semibold text-slate-200">${esc(c.label)}</span>
      </div>
      <div class="text-sm text-slate-100">${esc(c.value)}</div>
      <p class="text-[11px] text-slate-500 mt-1 leading-snug">${esc(c.hint)}</p>
    </div>`).join("");

  if (s.detail) {
    $("setup-checks").insertAdjacentHTML("beforeend",
      `<div class="sm:col-span-3 text-[11px] text-amber-300/70 px-1">${esc(s.detail)}</div>`);
  }
}

function renderExamples() {
  $("examples").innerHTML =
    `<span class="text-slate-600 font-medium">Try:</span>` +
    EXAMPLES.map((e) =>
      `<button class="ex px-2.5 py-1 rounded-full border border-slate-800 hover:border-sky-700/60 hover:text-sky-300 hover:bg-sky-900/10 transition-all" data-q="${esc(e)}">${esc(e)}</button>`
    ).join("");
  document.querySelectorAll(".ex").forEach((b) =>
    b.addEventListener("click", () => { $("query").value = b.dataset.q; runScan("topic"); })
  );
}

// --------------------------------------------------------------------------
// Scan
// --------------------------------------------------------------------------
async function runScan(mode) {
  const query = $("query").value.trim();
  if (mode === "topic" && !query) mode = "full-scan";

  setLoading(true);
  ["summary-section", "map"].forEach((id) => $(id).classList.add("hidden"));
  $("results").innerHTML = "";
  $("note").classList.add("hidden");
  $("note-text").textContent = "";

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, mode }),
    });
    const report = await res.json();
    lastReport = report;
    await animateTrace(report.trace || []);
    render(report);
  } catch (e) {
    $("note-text").textContent = "Request failed: " + e.message;
    $("note").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = $("run-btn");
  const icon = $("run-icon");
  const label = $("run-label");
  btn.disabled = on;
  if (on) {
    btn.classList.replace("bg-sky-600", "bg-sky-700");
    icon.outerHTML = `<svg id="run-icon" class="w-4 h-4 spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
    label.textContent = "Running…";
  } else {
    const btn2 = $("run-btn");
    btn2.classList.replace("bg-sky-700", "bg-sky-600");
    const icon2 = $("run-icon");
    if (icon2) {
      icon2.outerHTML = `<svg id="run-icon" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
    }
    $("run-label").textContent = "Run audit";
  }
}

async function animateTrace(steps) {
  const sec = $("trace-section"), list = $("trace");
  sec.classList.remove("hidden");
  list.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = "slide-in flex items-start gap-3 text-sm py-1.5 border-b border-slate-800/40 last:border-0";
    li.innerHTML = `
      <span class="trace-spinner mt-0.5 shrink-0">${ICON.spinner}</span>
      <span>
        <span class="font-medium text-slate-200">${esc(s.step)}</span>
        <span class="text-slate-500"> — ${esc(s.detail || "")}</span>
      </span>`;
    list.appendChild(li);
    await delay(320);
    li.querySelector(".trace-spinner").innerHTML = ICON.check;
  }
  await delay(100);
}

// --------------------------------------------------------------------------
// Render summary + filters
// --------------------------------------------------------------------------
function render(report) {
  const s = report.summary || {};
  const sevBits = [];
  if (s.critical) sevBits.push(`<span class="text-red-400">${s.critical} critical</span>`);
  if (s.high)     sevBits.push(`<span class="text-orange-400">${s.high} high</span>`);
  if (s.medium)   sevBits.push(`<span class="text-yellow-400">${s.medium} medium</span>`);
  if (s.low)      sevBits.push(`<span class="text-sky-400">${s.low} low</span>`);

  $("summary-text").innerHTML =
    `Scanned <strong class="text-slate-100">${s.sources_scanned || 0}</strong> sources · ` +
    `<strong class="text-slate-100">${s.conflicts_found || 0}</strong> conflicts` +
    (sevBits.length ? " — " + sevBits.join(", ") : "");
  $("summary-section").classList.remove("hidden");

  buildFilters(report.conflicts || []);
  applyFilters();

  if (report.note) {
    $("note-text").textContent = report.note;
    $("note").classList.remove("hidden");
  }
}

function buildFilters(conflicts) {
  const sevs = ["all", "critical", "high", "medium", "low"];
  const sources = ["all", ...new Set(
    conflicts.flatMap((c) => [c.side_a.source_ref.source_name, c.side_b.source_ref.source_name])
  )];
  filter = { severity: "all", source: "all" };

  $("filters").innerHTML =
    sevs.map((v) =>
      `<button class="fsev px-2.5 py-1 rounded-lg text-xs border transition-all ${v === "all" ? "filter-active" : "border-slate-700/80 text-slate-500 hover:border-slate-600 hover:text-slate-300"}" data-v="${v}">${v}</button>`
    ).join("") +
    `<select id="fsrc" class="ml-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-400 px-2 py-1 focus:outline-none focus:border-sky-700">
       ${sources.map((s) => `<option value="${esc(s)}">${s === "all" ? "all sources" : esc(s)}</option>`).join("")}
     </select>`;

  document.querySelectorAll(".fsev").forEach((b) =>
    b.addEventListener("click", () => {
      filter.severity = b.dataset.v;
      document.querySelectorAll(".fsev").forEach((x) => {
        const on = x.dataset.v === filter.severity;
        x.className = `fsev px-2.5 py-1 rounded-lg text-xs border transition-all ${on ? "filter-active" : "border-slate-700/80 text-slate-500 hover:border-slate-600 hover:text-slate-300"}`;
      });
      applyFilters();
    })
  );
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

// --------------------------------------------------------------------------
// Conflict-map (radial SVG)
// --------------------------------------------------------------------------
function renderGraph(conflicts) {
  const svg = $("graph");
  if (!conflicts.length) { $("map").classList.add("hidden"); svg.innerHTML = ""; return; }
  $("map").classList.remove("hidden");

  const nodes = new Map();
  conflicts.forEach((c) =>
    [c.side_a.source_ref, c.side_b.source_ref].forEach((r) => {
      const n = nodes.get(r.source_id) || { id: r.source_id, name: r.source_name, deg: 0 };
      n.deg++;
      nodes.set(r.source_id, n);
    })
  );

  const list = [...nodes.values()];
  const N = list.length;
  const cx = 320, cy = 200, R = 140;
  const pos = {};
  list.forEach((n, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    pos[n.id] = { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), a, n };
  });

  const pairTotals = {};
  conflicts.forEach((c) => {
    const k = [c.side_a.source_ref.source_id, c.side_b.source_ref.source_id].sort().join("|");
    pairTotals[k] = (pairTotals[k] || 0) + 1;
  });
  const pairSeen = {};

  const chords = conflicts.map((c) => {
    const A = pos[c.side_a.source_ref.source_id];
    const B = pos[c.side_b.source_ref.source_id];
    if (!A || !B) return "";
    const key = [c.side_a.source_ref.source_id, c.side_b.source_ref.source_id].sort().join("|");
    const idx = pairSeen[key] = (pairSeen[key] || 0);
    pairSeen[key]++;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    let cxx = mx + (cx - mx) * 0.55, cyy = my + (cy - my) * 0.55;
    const px = -(B.y - A.y), py = B.x - A.x, pl = Math.hypot(px, py) || 1;
    const off = (idx - (pairTotals[key] - 1) / 2) * 24;
    cxx += (px / pl) * off; cyy += (py / pl) * off;
    const w = (1.4 + (c.confidence || 0.5) * 2.6).toFixed(1);
    const col = SEV_HEX[c.severity] || SEV_HEX.low;
    return `<path class="chord" d="M${A.x.toFixed(1)},${A.y.toFixed(1)} Q${cxx.toFixed(1)},${cyy.toFixed(1)} ${B.x.toFixed(1)},${B.y.toFixed(1)}"
      stroke="${col}" stroke-width="${w}" opacity="0.5" data-cid="${esc(c.id)}">
      <title>${esc(c.title)}</title></path>`;
  }).join("");

  const nodeEls = list.map((n) => {
    const p = pos[n.id];
    const r = Math.min(10, 4.5 + n.deg * 1.1);
    const rightSide = Math.cos(p.a) >= -0.2;
    const lx = p.x + Math.cos(p.a) * 15, ly = p.y + Math.sin(p.a) * 15;
    const anchor = rightSide ? "start" : "end";
    const label = n.name.length > 20 ? n.name.slice(0, 19) + "…" : n.name;
    return `<g class="node">
      <circle class="node-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"
        fill="#0b1829" stroke="#1e3a5f" stroke-width="1.5">
        <title>${esc(n.name)} · ${n.deg} conflict(s)</title>
      </circle>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}"
        dominant-baseline="middle" fill="#94a3b8" font-size="11">${esc(label)}</text>
    </g>`;
  }).join("");

  svg.innerHTML = chords + nodeEls;

  $("graph-legend").innerHTML = ["critical", "high", "medium", "low"]
    .filter((s) => SEV_HEX[s])
    .map((s) =>
      `<span class="inline-flex items-center gap-1.5">
        <span style="width:16px;height:2.5px;background:${SEV_HEX[s]};display:inline-block;border-radius:2px"></span>
        <span>${s}</span>
      </span>`
    ).join("");

  svg.querySelectorAll(".chord").forEach((path) => {
    path.addEventListener("click", () => {
      const card = $("card-" + path.dataset.cid);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.remove("card-flash");
        void card.offsetWidth;
        card.classList.add("card-flash");
      }
    });
    path.addEventListener("mouseenter", () => {
      path.style.opacity = "1";
      path.style.strokeWidth = String(parseFloat(path.getAttribute("stroke-width")) + 1.5);
    });
    path.addEventListener("mouseleave", () => {
      path.style.opacity = "0.5";
      path.style.strokeWidth = path.getAttribute("stroke-width");
    });
  });
}

// --------------------------------------------------------------------------
// Conflict cards
// --------------------------------------------------------------------------
function citation(ref) {
  return [ref.source_type, ref.locator ? "§ " + ref.locator : null, ref.version, ref.effective_date]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
}

function sideCard(ref, statement, value) {
  const vEl = value
    ? `<span class="mono text-xs px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-200 border border-slate-700/60 whitespace-nowrap">${esc(value)}</span>`
    : "";
  return `<div class="rounded-xl border border-slate-700/60 bg-[#040d1a]/70 p-3 hover:border-sky-900/40 transition-colors">
    <div class="flex items-start justify-between gap-2 mb-1.5">
      <span class="text-sm font-semibold text-slate-100 leading-snug">${esc(ref.source_name)}</span>
      ${vEl}
    </div>
    <p class="text-sm text-slate-300 leading-snug">${esc(statement)}</p>
    <div class="mono text-[11px] text-slate-600 mt-2">${citation(ref)}</div>
  </div>`;
}

function renderConflicts(list) {
  const root = $("results");
  if (!list.length) { root.innerHTML = ""; return; }

  root.innerHTML = list.map((c) => {
    const sevClass = SEV_CLASS[c.severity] || SEV_CLASS.low;
    const barClass = SEV_BAR[c.severity] || SEV_BAR.low;
    const conf = Math.round((c.confidence || 0) * 100);

    const resolution = c.suggested_resolution
      ? `<div class="mt-3 pt-3 border-t border-slate-800/60 flex items-start gap-2 text-xs">
           <svg class="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <circle cx="12" cy="12" r="10"/><polyline points="12 8 12 12 14 14"/>
           </svg>
           <div>
             <span class="uppercase tracking-wider text-slate-600 mr-1">Suggested</span>
             <span class="text-slate-300">${esc(c.suggested_resolution)}</span>
             ${c.resolution_basis ? `<span class="text-slate-600"> — ${esc(c.resolution_basis)}</span>` : ""}
           </div>
         </div>`
      : "";

    return `<article id="card-${esc(c.id)}" class="conflict-card fade-in rounded-2xl border border-slate-800/70 bg-slate-900/30 p-4 sm:p-5 hover:border-sky-900/50">
      <header class="flex items-start justify-between gap-4 mb-3">
        <div>
          <div class="flex items-center gap-2 mb-1.5">
            <span class="px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wide border ${sevClass}">${esc(c.severity)}</span>
            <span class="px-2 py-0.5 rounded-md text-[11px] mono bg-slate-800/60 text-slate-400 border border-slate-700/60">${esc(c.type)}</span>
          </div>
          <h3 class="text-base font-semibold text-white leading-snug">${esc(c.title)}</h3>
        </div>
        <div class="shrink-0 w-24 text-right">
          <div class="text-[11px] text-slate-600 mb-1">confidence ${conf}%</div>
          <div class="h-1 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full ${barClass} rounded-full transition-all" style="width:${conf}%"></div>
          </div>
        </div>
      </header>
      ${c.explanation ? `<p class="text-sm text-slate-400 mb-3 leading-relaxed">${esc(c.explanation)}</p>` : ""}
      <div class="grid sm:grid-cols-2 gap-3">
        ${sideCard(c.side_a.source_ref, c.side_a.statement, c.side_a.value)}
        <div class="relative sm:hidden flex items-center justify-center py-1">
          <div class="absolute inset-x-0 top-1/2 h-px bg-slate-800"></div>
          <span class="relative z-10 px-2 text-[10px] font-bold text-slate-600 bg-[#040d1a] rounded tracking-widest">VS</span>
        </div>
        <div class="hidden sm:flex items-center justify-center relative">
          <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-slate-800"></div>
          <span class="relative z-10 px-2 py-0.5 text-[10px] font-bold text-slate-600 bg-[#040d1a] rounded tracking-widest border border-slate-800">VS</span>
        </div>
        ${sideCard(c.side_b.source_ref, c.side_b.statement, c.side_b.value)}
      </div>
      ${resolution}
    </article>`;
  }).join("");
}

// --------------------------------------------------------------------------
// Bootstrap
// --------------------------------------------------------------------------
$("run-btn").addEventListener("click", () => runScan("topic"));
$("scan-btn").addEventListener("click", () => runScan("full-scan"));
$("query").addEventListener("keydown", (e) => { if (e.key === "Enter") runScan("topic"); });
$("recheck").addEventListener("click", loadSetup);

renderExamples();
loadHealth();
loadSetup();
