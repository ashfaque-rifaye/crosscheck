// Crosscheck SPA — talks to /api/scan and renders the contradiction report.
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

const EXAMPLES = [
  "password policy",
  "MFA requirement",
  "refund window",
  "uptime SLA",
  "API rate limit",
  "database restart",
];

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
  el.className =
    "px-2.5 py-1 rounded-full border " +
    (accent
      ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
      : "border-slate-700 bg-slate-900 text-slate-300");
}

function renderExamples() {
  $("examples").innerHTML =
    `<span class="text-slate-500">Try:</span>` +
    EXAMPLES.map(
      (e) =>
        `<button class="ex px-2.5 py-1 rounded-full border border-slate-700 hover:border-violet-500 hover:text-violet-200 transition" data-q="${esc(e)}">${esc(e)}</button>`
    ).join("");
  document.querySelectorAll(".ex").forEach((b) =>
    b.addEventListener("click", () => {
      $("query").value = b.dataset.q;
      runScan("topic");
    })
  );
}

// --------------------------------------------------------------------------- //
async function runScan(mode) {
  const query = $("query").value.trim();
  if (mode === "topic" && !query) mode = "full-scan";

  setLoading(true);
  $("summary-section").classList.add("hidden");
  $("results").innerHTML = "";
  $("note").classList.add("hidden");

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
    $("note").textContent = "Request failed: " + e.message;
    $("note").classList.remove("hidden");
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  const btn = $("run-btn");
  btn.disabled = on;
  btn.innerHTML = on
    ? `<span class="inline-block h-4 w-4 border-2 border-white/40 border-t-white rounded-full spin align-middle"></span>`
    : "Run audit";
}

async function animateTrace(steps) {
  const sec = $("trace-section");
  const list = $("trace");
  sec.classList.remove("hidden");
  list.innerHTML = "";
  for (const s of steps) {
    const li = document.createElement("li");
    li.className = "fade-in flex items-start gap-3 text-sm";
    li.innerHTML = `
      <span class="trace-icon mt-0.5 h-4 w-4 border-2 border-violet-400/40 border-t-violet-400 rounded-full spin"></span>
      <span><span class="font-medium text-slate-200">${esc(s.step)}</span>
      <span class="text-slate-500">— ${esc(s.detail || "")}</span></span>`;
    list.appendChild(li);
    await delay(360);
    li.querySelector(".trace-icon").outerHTML = `<span class="mt-0.5 text-violet-400">✓</span>`;
  }
  await delay(150);
}

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
  renderConflicts(report.conflicts || []);

  if (report.note) {
    $("note").textContent = report.note;
    $("note").classList.remove("hidden");
  } else {
    $("note").classList.add("hidden");
  }
}

function buildFilters(conflicts) {
  const sevs = ["all", "high", "medium", "low"];
  const sources = ["all", ...new Set(conflicts.flatMap((c) => [c.side_a.source_ref.source_name, c.side_b.source_ref.source_name]))];
  filter = { severity: "all", source: "all" };
  $("filters").innerHTML =
    sevs
      .map(
        (v) =>
          `<button class="fsev px-2.5 py-1 rounded-lg text-xs border ${v === "all" ? "border-violet-500 text-violet-200" : "border-slate-700 text-slate-400"}" data-v="${v}">${v}</button>`
      )
      .join("") +
    `<select id="fsrc" class="ml-1 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 px-2 py-1">` +
    sources.map((s) => `<option value="${esc(s)}">${s === "all" ? "all sources" : esc(s)}</option>`).join("") +
    `</select>`;

  document.querySelectorAll(".fsev").forEach((b) =>
    b.addEventListener("click", () => {
      filter.severity = b.dataset.v;
      document.querySelectorAll(".fsev").forEach((x) => {
        const on = x.dataset.v === filter.severity;
        x.className = `fsev px-2.5 py-1 rounded-lg text-xs border ${on ? "border-violet-500 text-violet-200" : "border-slate-700 text-slate-400"}`;
      });
      applyFilters();
    })
  );
  $("fsrc").addEventListener("change", (e) => {
    filter.source = e.target.value;
    applyFilters();
  });
}

function applyFilters() {
  const all = lastReport?.conflicts || [];
  const list = all.filter((c) => {
    if (filter.severity !== "all" && c.severity !== filter.severity) return false;
    if (filter.source !== "all") {
      const names = [c.side_a.source_ref.source_name, c.side_b.source_ref.source_name];
      if (!names.includes(filter.source)) return false;
    }
    return true;
  });
  renderConflicts(list);
}

function citation(ref) {
  const bits = [ref.source_type, ref.locator ? "§ " + ref.locator : null, ref.version, ref.effective_date].filter(Boolean);
  return bits.map(esc).join(" · ");
}

function side(ref, statement, value, accent) {
  const v = value ? `<span class="mono text-xs px-2 py-0.5 rounded-md bg-slate-800 text-${accent}-200 whitespace-nowrap">${esc(value)}</span>` : "";
  return `
    <div class="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <div class="flex items-start justify-between gap-2 mb-1.5">
        <span class="text-sm font-semibold text-slate-100">${esc(ref.source_name)}</span>
        ${v}
      </div>
      <p class="text-sm text-slate-300 leading-snug">${esc(statement)}</p>
      <div class="mono text-[11px] text-slate-500 mt-2">${citation(ref)}</div>
    </div>`;
}

function renderConflicts(list) {
  const root = $("results");
  if (!list.length) {
    root.innerHTML = "";
    return;
  }
  root.innerHTML = list
    .map((c) => {
      const sev = SEV[c.severity] || SEV.low;
      const conf = Math.round((c.confidence || 0) * 100);
      const res = c.suggested_resolution
        ? `<div class="mt-3 text-xs text-slate-400 border-t border-slate-800 pt-3">
             <span class="uppercase tracking-wider text-slate-500 mr-1">Suggested</span>
             <span class="text-slate-300">${esc(c.suggested_resolution)}</span>
             ${c.resolution_basis ? `<span class="text-slate-500"> — ${esc(c.resolution_basis)}</span>` : ""}
           </div>`
        : "";
      return `
      <article class="fade-in rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
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
            <div class="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div class="h-full ${SEV_BAR[c.severity] || "bg-slate-500"}" style="width:${conf}%"></div>
            </div>
          </div>
        </header>
        ${c.explanation ? `<p class="text-sm text-slate-400 mb-3">${esc(c.explanation)}</p>` : ""}
        <div class="relative grid sm:grid-cols-2 gap-3">
          ${side(c.side_a.source_ref, c.side_a.statement, c.side_a.value, "rose")}
          ${side(c.side_b.source_ref, c.side_b.statement, c.side_b.value, "rose")}
          <div class="vs-line hidden sm:block absolute inset-0 pointer-events-none"></div>
        </div>
        ${res}
      </article>`;
    })
    .join("");
}

// --------------------------------------------------------------------------- //
$("run-btn").addEventListener("click", () => runScan("topic"));
$("scan-btn").addEventListener("click", () => runScan("full-scan"));
$("query").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runScan("topic");
});
renderExamples();
loadHealth();
