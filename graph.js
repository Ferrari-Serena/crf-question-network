/* 问题网络力导向图 —— d3-force + 交互 */
"use strict";

// 17 簇配色（cluster_id → 颜色）。V400 重跑 Louvain 后得到 17 个算法簇，扩展为 20 色备用。
const COLORS = [
  "#4e79a7", "#f28e2b", "#d62728", "#9467bd", "#59a14f", "#edc948", "#17becf",
  "#e15759", "#76b7b2", "#ff9da7", "#9c755f", "#bab0ac", "#86bc25", "#8c564b",
  "#b07aa1", "#bcbd22", "#7f7f7f", "#c49c94", "#98df8a", "#ffbb78",
];

// 17 簇语义名（V400 的 380 题 Louvain 分簇后人工归纳，非算法预设）。若重跑 cluster.py 导致簇编号漂移，需复核此表。
// 中英双语：默认英文（李博士要求），点右上角 EN ⇄ 中 切换。
const CLUSTER_NAMES = {
  en: {
    0: "Course Design & Workload",
    1: "Institution Funding & Reputation",
    2: "Firm Value Perception & Data Access",
    3: "Urgency & Time Mismatch",
    4: "Firm Efficiency & Commitment Signals",
    5: "Attrition Attribution & Contact Churn",
    6: "Incentive Alignment & Multitask",
    7: "Student Long-term Returns & Reputation",
    8: "Mentor Cost & Who Pays",
    9: "TA Load & Scalability",
    10: "Value Realization Lag & Scale",
    11: "Mechanism Design & Governance",
    12: "Success Measurement & Attribution",
    13: "Firm Hiring Motives & AI",
    14: "Transaction Costs",
    15: "Signaling & Screening",
    16: "Sustainability & Attrition",
  },
  cn: {
    0: "课程设计与教学负荷",
    1: "院系资源与声誉激励",
    2: "企业价值认知与数据可得",
    3: "谁更着急·时间错配",
    4: "企业效率与承诺信号",
    5: "流失归因与对接人变动",
    6: "激励对齐与多任务",
    7: "学生长期回报与声誉替代",
    8: "导师成本与谁承担",
    9: "助教负荷与可扩展性",
    10: "价值兑现滞后与规模化",
    11: "机制设计·治理",
    12: "成功度量与归因",
    13: "企业招聘动机与 AI",
    14: "交易成本结构",
    15: "信号·筛选",
    16: "持续性·流失",
  },
};
function clusterName(id) {
  const name = (CLUSTER_NAMES[lang] || CLUSTER_NAMES.cn)[id];
  return name || (lang === "en" ? `Cluster ${id + 1}` : `簇 ${id + 1}`);
}
function clusterLabel(id) { return lang === "en" ? `Cluster ${id + 1}` : `簇${id + 1}`; }

const STAKEHOLDER = {
  enterprise: { en: "Firm", cn: "企业方" },
  institution: { en: "Institution", cn: "院系方" },
  instructor: { en: "Instructor", cn: "老师方" },
  ta: { en: "Teaching Assistant", cn: "助教方" },
  student: { en: "Student", cn: "学生方" },
  null: { en: "Cross-cutting", cn: "横切" },
};
const THEORY = {
  signaling: { en: "Signaling", cn: "信号" },
  types: { en: "Types", cn: "型别" },
  mechanism_design: { en: "Mechanism Design", cn: "机制设计" },
  principal_agent: { en: "Principal-Agent", cn: "委托代理" },
};
const CROSS = {
  governance: { en: "Governance / Mechanism", cn: "治理/机制" },
  sustainability: { en: "Sustainability", cn: "持续性" },
  methodology: { en: "Methodology", cn: "方法论" },
  constraint: { en: "Constraint", cn: "约束" },
  imbalance: { en: "Imbalance", cn: "失衡" },
};
const CHAIN = {
  efficiency: { en: "Efficiency", cn: "效率" },
  impact: { en: "Impact", cn: "产出" },
  alignment: { en: "Alignment", cn: "对齐" },
  incentive: { en: "Incentive", cn: "动机" },
};

// 取双语条目当前语言的值；回退中文，再回退空。
const L = (entry) => entry ? (entry[lang] || entry.cn) : "";
function theoryLabel(val) {
  const entry = THEORY[val];
  if (!entry) return val;
  return lang === "en" ? entry.en : "诺奖·" + entry.cn;
}
function chainLabel(val) {
  const entry = CHAIN[val];
  return entry ? (lang === "en" ? entry.en : entry.cn) : val;
}

// 数据里的中文短编号（新①/子2/研①/治⑨/课①/⑪…）在英文态显示为英文短码。
function cnNum(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x2460 && cp <= 0x2473) ? String(cp - 0x245f) : ch;
}
function labelEn(s) {
  const m = String(s).match(/^(子|新|研|治|课)(\d+|[①-⑳]+)$/);
  if (m) {
    const prefix = { 子: 'Sub ', 新: 'New ', 研: 'Res ', 治: 'Gov ', 课: 'Course ' }[m[1]];
    return prefix + [...m[2]].map(cnNum).join('');
  }
  return [...String(s)].map(cnNum).join('');
}
function displayLabel(label) {
  return lang === "en" ? labelEn(label) : label;
}

// 图内 UI 文案（指标面板 / 详情 / 图例等），随 lang 切换。
const UI = {
  en: {
    statsNodes: "Nodes", statsEdges: "Edges", statsAvgDegree: "Avg degree", statsClusters: "Clusters",
    modularity: "Modularity", unverified: "unverified",
    clusterCenters: "Cluster centers (click to jump)", colCluster: "Cluster", colSize: "Size",
    colCenter: "Center question", colDegree: "Degree", topDegree: "Top degree", topBetween: "Top betweenness", topEigen: "Top eigenvector",
    question: "Question", value: "Value", centerWord: "center",
    detailNo: "No.", whyLinked: "Why linked (shared tags / citations)", citation: "Source / Citation",
    centrality: "Centrality", degree: "Degree", betweenness: "Betweenness", eigenvector: "Eigenvector",
    noSource: "No source (TBD)", emptyDetail: "Click any node for details",
  },
  cn: {
    statsNodes: "节点数", statsEdges: "边数", statsAvgDegree: "平均度 average link", statsClusters: "簇数",
    modularity: "模块度", unverified: "待核实",
    clusterCenters: "每簇中心问题（点击跳转）", colCluster: "簇", colSize: "规模",
    colCenter: "中心问题", colDegree: "度", topDegree: "Top 度数中心", topBetween: "Top 中介中心", topEigen: "Top 特征向量中心",
    question: "题", value: "值", centerWord: "中心",
    detailNo: "编号", whyLinked: "为什么连（共享标签/文献）", citation: "出处 / Citation",
    centrality: "中心性", degree: "度 (degree)", betweenness: "中介 (betweenness)", eigenvector: "特征向量 (eigenvector)",
    noSource: "无出处（source TBD）", emptyDetail: "点击任意节点查看详情",
  },
};
const T = (key) => (UI[lang] && UI[lang][key]) || UI.cn[key] || key;

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
    .text(d => d.short_id || d.id);

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
  const uniq = [...new Set(shared)].slice(0, 4).map(prettyTag).join(lang === "en" ? ", " : "、");
  const txt = nodeText(d);
  tooltip.html(`
    <div class="t-title">${d.id} ${lang === "en" ? `(No. ${displayLabel(d.label)})` : `（编号 ${displayLabel(d.label)}）`} · ${stakeholderLabel(d)}</div>
    <div>${txt.length > 120 ? txt.slice(0, 120) + "…" : txt}</div>
    ${uniq ? `<div class="t-why">${lang === "en" ? "Linked: " : "连："}${uniq}</div>` : ""}
  `).attr("hidden", null);
  moveTooltip(ev);
}
function moveTooltip(ev) {
  const [mx, my] = d3.pointer(ev, document.body);
  tooltip.style("left", (mx + 14) + "px").style("top", (my - 10) + "px");
}
function hideTooltip() { hoverNode = null; tooltip.attr("hidden", ""); applyActive(); }

function stakeholderLabel(n) {
  const key = n.stakeholder ?? "null";
  return L(STAKEHOLDER[key]) || (lang === "en" ? (n.stakeholder || "cross-cutting") : "横切");
}
function prettyTag(t) {
  const [type, ...rest] = t.split(":");
  const val = rest.join(":");
  if (type === "theory") return theoryLabel(val);
  if (type === "cross") return L(CROSS[val]) || val;
  if (type === "cluster") return lang === "en" ? val : val.replace(/ cluster$/, "簇");
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
    ...(n.theory_tags || []).map(t => `<span class="badge theory">${theoryLabel(t)}</span>`),
    ...(n.cluster_mode || []).map(c => `<span class="badge">${lang === "en" ? c : c.replace(/ cluster$/, "簇")}</span>`),
    ...(n.crosscutting || []).map(c => `<span class="badge">${L(CROSS[c]) || c}</span>`),
    ...(n.chain_step ? [`<span class="badge">${chainLabel(n.chain_step)}</span>`] : []),
  ].join("");

  const cites = (n.citations || []).map(c => {
    let body = "";
    if (c.doi && !c.unverified) {
      body = `<a href="https://doi.org/${c.doi}" target="_blank" rel="noopener">${esc(c.label || c.doi)}</a>`;
    } else if (c.url) {
      body = `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label || c.key || c.url)}</a>`;
    } else {
      body = esc(c.label || c.key || "");
      if (c.unverified) body += ` <span class="badge warn">⚠ ${T("unverified")}</span>`;
    }
    return `<div class="cite">${body}</div>`;
  }).join("");

  detail.html(`
    <h2>${n.id} <span style="color:#999;font-weight:400;font-size:12px">${T("detailNo")} ${displayLabel(n.label)}</span></h2>
    <div class="meta">${badges}</div>
    <div class="qtext">${esc(nodeText(n))}</div>
    ${sharedUniq.length ? `<div class="sec"><h4>${T("whyLinked")}</h4><div>${sharedUniq.map(t => `<span class="badge">${t}</span>`).join("")}</div></div>` : ""}
    <div class="sec"><h4>${T("citation")}</h4>${cites || `<div style='color:#999'>${T("noSource")}</div>`}</div>
    <div class="sec"><h4>${T("centrality")}</h4>
      <table style="font-size:12px;width:100%">
        <tr><td>${T("degree")}</td><td>${n.degree}</td></tr>
        <tr><td>${T("betweenness")}</td><td>${n.betweenness_centrality}</td></tr>
        <tr><td>${T("eigenvector")}</td><td>${n.eigenvector_centrality}</td></tr>
      </table>
    </div>
  `);
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function updateDetailEmpty() {
  const sub = lang === "en"
    ? `${nodes.length} questions · ${metrics?.n_clusters ?? "…"} clusters`
    : `共 ${nodes.length} 题 · ${metrics?.n_clusters ?? "…"} 簇`;
  detail.html(`<div class="detail-empty">${T("emptyDetail")}<br><span style="font-size:11px">${sub}</span></div>`);
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
  el.innerHTML = "";
  items.forEach(({ value, label, color, cnt }) => {
    const div = document.createElement("label");
    div.className = "chk";
    const dot = color ? `<span class="dot" style="background:${color}"></span>` : "";
    div.innerHTML = `<input type="checkbox" value="${value}">${dot}<span>${label}</span><span class="cnt">${cnt}</span>`;
    el.appendChild(div);
  });
  if (!el.dataset.bound) { el.addEventListener("change", applyActive); el.dataset.bound = "1"; }
}

function buildFilters() {
  const cnt = (fn) => nodes.filter(fn).length;
  buildFilterGroup("#filter-stakeholder", [
    ["enterprise", "#4e79a7"], ["institution", "#f28e2b"],
    ["instructor", "#e15759"], ["ta", "#76b7b2"],
    ["student", "#59a14f"], ["__null__", "#edc948"],
  ].map(([value, color]) => {
    const key = value === "__null__" ? "null" : value;
    return { value, label: L(STAKEHOLDER[key]), color, cnt: cnt(n => (n.stakeholder ?? "__null__") === value) };
  }));
  buildFilterGroup("#filter-theory", [
    ["signaling", null], ["types", null],
    ["mechanism_design", null], ["principal_agent", null],
  ].map(([value]) => ({ value, label: theoryLabel(value), cnt: cnt(n => n.theory_tags.includes(value)) })));
  buildFilterGroup("#filter-chain", [
    ["efficiency", null], ["impact", null],
    ["alignment", null], ["incentive", null],
  ].map(([value]) => ({ value, label: chainLabel(value), cnt: cnt(n => n.chain_step === value) })));
  buildFilterGroup("#filter-cluster",
    (metrics?.cluster_centers || []).map(cc => ({
      value: String(cc.cluster_id), label: `${clusterLabel(cc.cluster_id)} · ${clusterName(cc.cluster_id)}`, color: clusterColor(cc.cluster_id), cnt: cc.size,
    })));
}

function buildLegend() {
  const items = (metrics?.cluster_centers || []).map(cc => `
    <div class="li"><span class="dot" style="background:${clusterColor(cc.cluster_id)}"></span>
    ${clusterLabel(cc.cluster_id)} · ${clusterName(cc.cluster_id)} · ${T("centerWord")} [${displayLabel(cc.label)}]</div>`).join("");
  d3.select("#legend").html(items);
}

/* ---------------- 指标面板 ---------------- */
function showMetrics() {
  if (!metrics) return;
  const m = metrics;
  const statRow = (label, val) => `<div class="stat"><div class="v">${val}</div><div class="k">${label}</div></div>`;
  const topTable = (title, rows) => `
    <h4 style="margin:14px 0 4px">${title}</h4>
    <table><tr><th>#</th><th>${T("question")}</th><th>${T("value")}</th></tr>
    ${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.id} [${displayLabel(r.label)}]</td><td>${r.value}</td></tr>`).join("")}
    </table>`;
  document.querySelector("#metrics-body").innerHTML = `
    <div class="stat-row">
      ${statRow(T("statsNodes"), m.n_nodes)}
      ${statRow(T("statsEdges"), m.n_edges)}
      ${statRow(T("statsAvgDegree"), m.avg_degree)}
      ${statRow(T("statsClusters"), m.n_clusters)}
      ${statRow(T("modularity"), m.modularity)}
    </div>
    <h4 style="margin:14px 0 4px">${T("clusterCenters")}</h4>
    <table>
      <tr><th>${T("colCluster")}</th><th>${T("colSize")}</th><th>${T("colCenter")}</th><th>${T("colDegree")}</th></tr>
      ${m.cluster_centers.map(cc => `
        <tr class="cluster-row" data-id="${cc.center}">
          <td><span class="dot" style="background:${clusterColor(cc.cluster_id)};width:10px;height:10px;border-radius:50%;display:inline-block"></span> ${clusterLabel(cc.cluster_id)}<br><span style="color:#999;font-size:11px">${clusterName(cc.cluster_id)}</span></td>
          <td>${cc.size}</td><td>${cc.center} [${displayLabel(cc.label)}]</td><td>${cc.degree}</td>
        </tr>`).join("")}
    </table>
    ${topTable(T("topDegree"), m.top_degree)}
    ${topTable(T("topBetween"), m.top_betweenness)}
    ${topTable(T("topEigen"), m.top_eigenvector)}
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

/* ---------------- 语言切换 · 全量重渲染 ---------------- */
function restoreFilters(saved) {
  const check = (sel, vals) => {
    document.querySelectorAll(`${sel} input[type="checkbox"]`).forEach(i => {
      i.checked = vals.includes(i.value);
    });
  };
  check("#filter-stakeholder", saved.stakeholder);
  check("#filter-theory", saved.theory);
  check("#filter-chain", saved.chain);
  check("#filter-cluster", saved.cluster);
}

function renderAll() {
  const saved = collectFilters();
  hoverNode = null;
  tooltip.attr("hidden", "");
  buildFilters();
  restoreFilters(saved);
  applyActive();
  buildLegend();
  document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
  if (currentDetailId) {
    const n = nodes.find(x => x.id === currentDetailId);
    if (n) showDetail(n);
  } else {
    updateDetailEmpty();
  }
  const metricsOverlay = document.querySelector("#metrics-overlay");
  if (!metricsOverlay.hidden) showMetrics();
}

/* ---------------- 事件绑定 ---------------- */
document.querySelector("#lang-toggle").addEventListener("click", function () {
  lang = lang === "en" ? "cn" : "en";
  this.textContent = lang === "en" ? "EN ⇄ 中" : "中 ⇄ EN";
  this.classList.toggle("active", lang === "cn");
  renderAll();
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
