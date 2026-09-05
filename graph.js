/* 问题网络力导向图 —— d3-force + 交互 */
"use strict";

// 7 簇配色（cluster_id → 颜色）。2026-09-05 调过：原 簇2红/簇3青/簇4绿 三色相邻易混，
// 改为 簇3 青→紫、簇6 紫→青，红加深，让「持续性·型别·机制设计」三团拉开色相。
const COLORS = ["#4e79a7", "#f28e2b", "#d62728", "#9467bd", "#59a14f", "#edc948", "#17becf", "#ff9da7", "#9c755f", "#bab0ac"];

// 7 簇语义名（Louvain 分簇后人工归纳，非算法预设）。若重跑 cluster.py 导致簇编号漂移，需复核此表。
const CLUSTER_NAMES = {
  0: "激励传导",
  1: "企业动机·课程落地",
  2: "持续性·流失",
  3: "人才型别",
  4: "机制设计·治理",
  5: "信号·筛选",
  6: "谁更着急·公平",
};
function clusterName(id) { return CLUSTER_NAMES[id] || `簇 ${id + 1}`; }

const STAKEHOLDER_CN = {
  enterprise: "企业方", institution: "院系方", instructor: "老师方",
  ta: "助教方", student: "学生方", null: "横切",
};
const THEORY_CN = {
  signaling: "信号", types: "型别", mechanism_design: "机制设计", principal_agent: "委托代理",
};
const CROSS_CN = {
  governance: "治理/机制", sustainability: "持续性", methodology: "方法论",
};
const CHAIN_CN = { efficiency: "Efficiency", impact: "Impact", alignment: "Alignment", incentive: "Incentive" };

let nodes = [], edges = [], metrics = null;
let lang = "en";           // en | cn
let sim, svg, g, linkSel, nodeSel, labelSel, zoomBehavior;
let activeSet = null;      // 当前应正常显示的节点 id 集（null = 全部）
let hoverNode = null;
let currentDetailId = null;

// forceLink 会把 edge.source/target 原地从 id 字符串替换成 node 对象，统一取 id
const sid = x => (typeof x === "string" ? x : x.id);

const svgEl = d3.select("#graph");
const wrap = d3.select("#graph-wrap");
const tooltip = d3.select("#tooltip");
const detail = d3.select("#detail");

function clusterColor(id) { return COLORS[id % COLORS.length]; }
function nodeRadius(d) {
  // 线性放大 degree：度 5≈9px，度 18≈22px，让枢纽节点一眼可见
  return Math.min(24, Math.max(7, 4 + (d.degree || 1)));
}
function nodeText(n) { return lang === "en" ? (n.text_en || "") : (n.text_cn || n.text_en || ""); }

function resolveDim() {
  return { w: wrap.node().clientWidth, h: wrap.node().clientHeight };
}

async function load() {
  const [n, e, m] = await Promise.all([
    fetch("data/nodes.json").then(r => r.json()),
    fetch("data/edges.json").then(r => r.json()),
    fetch("data/metrics.json").then(r => r.json()),
  ]);
  nodes = n; edges = e; metrics = m;
  buildGraph();
  buildFilters();
  buildLegend();
  updateDetailEmpty();
}

/* ---------------- 图渲染 ---------------- */
function buildGraph() {
  const { w, h } = resolveDim();
  svg = svgEl.attr("viewBox", [0, 0, w, h]);
  g = svg.append("g");

  // 缩放
  zoomBehavior = d3.zoom().scaleExtent([0.2, 6]).on("zoom", (ev) => g.attr("transform", ev.transform));
  svg.call(zoomBehavior);
  // 双击空白重置
  svg.on("dblclick.zoom", null);

  const idMap = new Map(nodes.map(n => [n.id, n]));

  linkSel = g.append("g").selectAll("line")
    .data(edges).join("line")
    .attr("class", "link")
    .attr("stroke-width", d => 0.4 + Math.sqrt(d.weight) * 3);

  nodeSel = g.append("g").selectAll("g")
    .data(nodes).join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", (ev, d) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
      .on("end", (ev, d) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

  nodeSel.append("circle")
    .attr("r", d => nodeRadius(d))
    .attr("fill", d => clusterColor(d.cluster_id));

  labelSel = g.append("g").selectAll("text")
    .data(nodes).join("text")
    .attr("class", "node-label")
    .attr("dy", d => -nodeRadius(d) - 3)
    .text(d => d.id);

  // 力模拟
  sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(edges).id(d => d.id)
      .distance(d => 55 / (0.2 + d.weight * 2))
      .strength(d => 0.15 + d.weight * 0.85))
    .force("charge", d3.forceManyBody().strength(-320))
    .force("center", d3.forceCenter(w / 2, h / 2))
    .force("collide", d3.forceCollide().radius(d => nodeRadius(d) + 2));

  sim.on("tick", () => {
    linkSel.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
    labelSel.attr("x", d => d.x).attr("y", d => d.y);
  });

  // 节点交互
  nodeSel
    .on("mouseover", (ev, d) => showTooltip(ev, d))
    .on("mousemove", (ev) => moveTooltip(ev))
    .on("mouseout", () => hideTooltip())
    .on("click", (ev, d) => { ev.stopPropagation(); showDetail(d); });

  svg.on("click", () => { hoverNode = null; applyActive(); });
}

/* ---------------- 活跃集（筛选 + 搜索） ---------------- */
function computeActiveSet() {
  const f = collectFilters();
  const q = d3.select("#search").property("value").trim().toLowerCase();

  let set = null;
  // 筛选
  if (f.stakeholder.length || f.theory.length || f.chain.length || f.cluster.length) {
    set = new Set(nodes.filter(n => {
      const okSt = !f.stakeholder.length || f.stakeholder.includes(n.stakeholder ?? "__null__");
      const okTh = !f.theory.length || f.theory.some(t => n.theory_tags.includes(t));
      const okCh = !f.chain.length || (n.chain_step && f.chain.includes(n.chain_step));
      const okCl = !f.cluster.length || f.cluster.includes(String(n.cluster_id));
      return okSt && okTh && okCh && okCl;
    }).map(n => n.id));
  }
  // 搜索
  if (q) {
    const hits = new Set(nodes.filter(n =>
      (n.text_en || "").toLowerCase().includes(q) ||
      (n.text_cn || "").includes(q) ||
      n.label.includes(q)
    ).map(n => n.id));
    // 命中 + 邻居
    const withNbr = new Set(hits);
    edges.forEach(e => {
      const s = sid(e.source), t = sid(e.target);
      if (hits.has(s) || hits.has(t)) { withNbr.add(s); withNbr.add(t); }
    });
    set = set ? new Set([...set].filter(x => withNbr.has(x))) : withNbr;
  }
  return set;
}

function applyActive() {
  activeSet = computeActiveSet();

  nodeSel.select("circle")
    .attr("opacity", d => (!activeSet || activeSet.has(d.id)) ? 1 : 0.12)
    .attr("stroke", d => (hoverNode && (d === hoverNode || isNeighbor(d, hoverNode))) ? "#1f2430" : "#fff")
    .attr("stroke-width", d => (hoverNode && (d === hoverNode || isNeighbor(d, hoverNode))) ? 2.5 : 1);
  labelSel
    .attr("opacity", d => (!activeSet || activeSet.has(d.id)) ? 0.9 : 0.12);
  linkSel
    .attr("opacity", d => {
      if (activeSet && !(activeSet.has(d.source.id) && activeSet.has(d.target.id))) return 0.05;
      if (hoverNode && d.source !== hoverNode && d.target !== hoverNode) return 0.06;
      return 0.5;
    })
    .attr("stroke", d => (hoverNode && (d.source === hoverNode || d.target === hoverNode)) ? "#4e79a7" : "#c9ced6");
}

function isNeighbor(d, center) {
  return edges.some(e => (e.source.id === center.id && e.target.id === d.id) || (e.target.id === center.id && e.source.id === d.id));
}

/* ---------------- tooltip ---------------- */
function showTooltip(ev, d) {
  hoverNode = d;
  applyActive();
  const shared = edges.filter(e => (e.source.id === d.id || e.target.id === d.id))
    .map(e => e.shared_tags).flat().filter(t => t && !t.startsWith("misc:"));
  const uniq = [...new Set(shared)].slice(0, 4).map(prettyTag).join("、");
  const txt = nodeText(d);
  tooltip.html(`
    <div class="t-title">${d.id}（编号 ${d.label}）· ${stakeholderLabel(d)}</div>
    <div>${txt.length > 120 ? txt.slice(0, 120) + "…" : txt}</div>
    ${uniq ? `<div class="t-why">连：${uniq}</div>` : ""}
  `).attr("hidden", null);
  moveTooltip(ev);
}
function moveTooltip(ev) {
  const [mx, my] = d3.pointer(ev, document.body);
  tooltip.style("left", (mx + 14) + "px").style("top", (my - 10) + "px");
}
function hideTooltip() { hoverNode = null; tooltip.attr("hidden", ""); applyActive(); }

function stakeholderLabel(n) {
  return lang === "en"
    ? (n.stakeholder ?? "cross-cutting")
    : STAKEHOLDER_CN[n.stakeholder ?? null];
}
function prettyTag(t) {
  const [type, ...rest] = t.split(":");
  const val = rest.join(":");
  if (type === "theory") return "诺奖·" + (THEORY_CN[val] || val);
  if (type === "cross") return CROSS_CN[val] || val;
  if (type === "cluster") return val.replace(/ cluster$/, "簇");
  if (type === "cite") return val;
  return val;
}

/* ---------------- 详情面板 ---------------- */
function showDetail(n) {
  currentDetailId = n.id;
  const shared = edges.filter(e => (e.source.id === n.id || e.target.id === n.id))
    .map(e => e.shared_tags).flat().filter(t => t && !t.startsWith("misc:"));
  const sharedUniq = [...new Set(shared)].map(prettyTag);

  const badges = [
    `<span class="badge">${stakeholderLabel(n)}</span>`,
    ...(n.theory_tags || []).map(t => `<span class="badge theory">诺奖·${THEORY_CN[t] || t}</span>`),
    ...(n.cluster_mode || []).map(c => `<span class="badge">${c.replace(/ cluster$/, "簇")}</span>`),
    ...(n.crosscutting || []).map(c => `<span class="badge">${CROSS_CN[c] || c}</span>`),
    ...(n.chain_step ? [`<span class="badge">${CHAIN_CN[n.chain_step]}</span>`] : []),
  ].join("");

  const cites = (n.citations || []).map(c => {
    let body = "";
    if (c.doi && !c.unverified) {
      body = `<a href="https://doi.org/${c.doi}" target="_blank" rel="noopener">${esc(c.label || c.doi)}</a>`;
    } else if (c.url) {
      body = `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label || c.key || c.url)}</a>`;
    } else {
      body = esc(c.label || c.key || "");
      if (c.unverified) body += ` <span class="badge warn">⚠ 待核实</span>`;
    }
    return `<div class="cite">${body}</div>`;
  }).join("");

  detail.html(`
    <h2>${n.id} <span style="color:#999;font-weight:400;font-size:12px">编号 ${n.label}</span></h2>
    <div class="meta">${badges}</div>
    <div class="qtext">${esc(nodeText(n))}</div>
    ${sharedUniq.length ? `<div class="sec"><h4>为什么连（共享标签/文献）</h4><div>${sharedUniq.map(t => `<span class="badge">${t}</span>`).join("")}</div></div>` : ""}
    <div class="sec"><h4>出处 / Citation</h4>${cites || "<div style='color:#999'>无出处（source TBD）</div>"}</div>
    <div class="sec"><h4>中心性</h4>
      <table style="font-size:12px;width:100%">
        <tr><td>度 (degree)</td><td>${n.degree}</td></tr>
        <tr><td>中介 (betweenness)</td><td>${n.betweenness_centrality}</td></tr>
        <tr><td>特征向量 (eigenvector)</td><td>${n.eigenvector_centrality}</td></tr>
      </table>
    </div>
  `);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function updateDetailEmpty() {
  detail.html(`<div class="detail-empty">点击任意节点查看详情<br><span style="font-size:11px">共 ${nodes.length} 题 · ${metrics?.n_clusters ?? "…"} 簇</span></div>`);
}

/* ---------------- 筛选器 ---------------- */
function collectFilters() {
  const get = sel => [...document.querySelectorAll(sel + " input:checked")].map(i => i.value);
  return {
    stakeholder: get("#filter-stakeholder"),
    theory: get("#filter-theory"),
    chain: get("#filter-chain"),
    cluster: get("#filter-cluster"),
  };
}

function buildFilterGroup(sel, items) {
  const el = document.querySelector(sel);
  items.forEach(({ value, label, color, cnt }) => {
    const div = document.createElement("label");
    div.className = "chk";
    const dot = color ? `<span class="dot" style="background:${color}"></span>` : "";
    div.innerHTML = `<input type="checkbox" value="${value}">${dot}<span>${label}</span><span class="cnt">${cnt}</span>`;
    el.appendChild(div);
  });
  el.addEventListener("change", applyActive);
}

function buildFilters() {
  const cnt = (fn) => nodes.filter(fn).length;
  buildFilterGroup("#filter-stakeholder", [
    ["enterprise", "企业方", "#4e79a7"], ["institution", "院系方", "#f28e2b"],
    ["instructor", "老师方", "#e15759"], ["ta", "助教方", "#76b7b2"],
    ["student", "学生方", "#59a14f"], ["__null__", "横切", "#edc948"],
  ].map(([value, label, color]) => ({ value, label, color, cnt: cnt(n => (n.stakeholder ?? "__null__") === value) })));
  buildFilterGroup("#filter-theory", [
    ["signaling", "诺奖·信号", null], ["types", "诺奖·型别", null],
    ["mechanism_design", "诺奖·机制设计", null], ["principal_agent", "诺奖·委托代理", null],
  ].map(([value, label]) => ({ value, label, cnt: cnt(n => n.theory_tags.includes(value)) })));
  buildFilterGroup("#filter-chain", [
    ["efficiency", "Efficiency", null], ["impact", "Impact", null],
    ["alignment", "Alignment", null], ["incentive", "Incentive", null],
  ].map(([value, label]) => ({ value, label, cnt: cnt(n => n.chain_step === value) })));
  buildFilterGroup("#filter-cluster",
    (metrics?.cluster_centers || []).map(cc => ({
      value: String(cc.cluster_id), label: `簇${cc.cluster_id + 1}·${clusterName(cc.cluster_id)}`, color: clusterColor(cc.cluster_id), cnt: cc.size,
    })));
}

function buildLegend() {
  const items = (metrics?.cluster_centers || []).map(cc => `
    <div class="li"><span class="dot" style="background:${clusterColor(cc.cluster_id)}"></span>
    簇 ${cc.cluster_id + 1} · ${clusterName(cc.cluster_id)} · 中心 [${cc.label}]</div>`).join("");
  d3.select("#legend").html(items);
}

/* ---------------- 指标面板 ---------------- */
function showMetrics() {
  if (!metrics) return;
  const m = metrics;
  const statRow = (label, val) => `<div class="stat"><div class="v">${val}</div><div class="k">${label}</div></div>`;
  const topTable = (title, rows) => `
    <h4 style="margin:14px 0 4px">${title}</h4>
    <table><tr><th>#</th><th>题</th><th>值</th></tr>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.id} [${r.label}]</td><td>${r.value}</td></tr>`).join("")}
    </table>`;
  document.querySelector("#metrics-body").innerHTML = `
    <div class="stat-row">
      ${statRow("节点数", m.n_nodes)}
      ${statRow("边数", m.n_edges)}
      ${statRow("平均度 average link", m.avg_degree)}
      ${statRow("簇数", m.n_clusters)}
      ${statRow("Modularity", m.modularity)}
    </div>
    <h4 style="margin:14px 0 4px">每簇中心问题（点击跳转）</h4>
    <table>
      <tr><th>簇</th><th>规模</th><th>中心问题</th><th>度</th></tr>
      ${m.cluster_centers.map(cc => `
        <tr class="cluster-row" data-id="${cc.center}">
          <td><span class="dot" style="background:${clusterColor(cc.cluster_id)};width:10px;height:10px;border-radius:50%;display:inline-block"></span> 簇${cc.cluster_id + 1}<br><span style="color:#999;font-size:11px">${clusterName(cc.cluster_id)}</span></td>
          <td>${cc.size}</td><td>${cc.center} [${cc.label}]</td><td>${cc.degree}</td>
        </tr>`).join("")}
    </table>
    ${topTable("Top 度数中心", m.top_degree)}
    ${topTable("Top 中介中心", m.top_betweenness)}
    ${topTable("Top 特征向量中心", m.top_eigenvector)}
  `;
  document.querySelector("#metrics-overlay").hidden = false;
  document.querySelectorAll(".cluster-row").forEach(tr =>
    tr.addEventListener("click", () => {
      document.querySelector("#metrics-overlay").hidden = true;
      const n = nodes.find(x => x.id === tr.dataset.id);
      if (n) { showDetail(n); zoomTo(n); }
    }));
}

function zoomTo(n) {
  if (!n) return;
  const { w, h } = resolveDim();
  // 先平移到原点(-n.x,-n.y) → 放大 → 再移到画布中心，节点才会真正居中
  const t = d3.zoomIdentity.translate(w / 2, h / 2).scale(2).translate(-n.x, -n.y);
  svg.transition().duration(500).call(zoomBehavior.transform, t);
}

/* ---------------- 事件绑定 ---------------- */
document.querySelector("#lang-toggle").addEventListener("click", function () {
  lang = lang === "en" ? "cn" : "en";
  this.textContent = lang === "en" ? "EN ⇄ 中" : "中 ⇄ EN";
  this.classList.toggle("active", lang === "cn");
  if (currentDetailId) {
    const n = nodes.find(x => x.id === currentDetailId);
    if (n) showDetail(n);
  }
});
document.querySelector("#metrics-toggle").addEventListener("click", showMetrics);
document.querySelector("#readme-toggle").addEventListener("click", () => document.querySelector("#readme-overlay").hidden = false);
document.querySelector("#readme-close").addEventListener("click", () => document.querySelector("#readme-overlay").hidden = true);
document.querySelector("#readme-overlay").addEventListener("click", e => { if (e.target.id === "readme-overlay") e.target.hidden = true; });
document.querySelector("#metrics-close").addEventListener("click", () => document.querySelector("#metrics-overlay").hidden = true);
document.querySelector("#metrics-overlay").addEventListener("click", e => { if (e.target.id === "metrics-overlay") e.target.hidden = true; });
document.querySelector("#reset-view").addEventListener("click", () => {
  svg.transition().duration(400).call(zoomBehavior.transform, d3.zoomIdentity);
});
document.querySelector("#clear-filters").addEventListener("click", () => {
  document.querySelectorAll(".sidebar input:checked").forEach(i => i.checked = false);
  applyActive();
});
document.querySelector("#search").addEventListener("input", applyActive);

// 窗口尺寸变化
window.addEventListener("resize", () => {
  const { w, h } = resolveDim();
  svgEl.attr("viewBox", [0, 0, w, h]);
  sim.force("center", d3.forceCenter(w / 2, h / 2)).alpha(0.3).restart();
});

load();
