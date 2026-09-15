/* Shanghai Metro Fare Calculator */
(function () {
  "use strict";

  const DATA = window.METRO_DATA;
  if (!DATA || !DATA.lines) {
    document.body.innerHTML = "<p style='padding:24px;font-family:sans-serif'>数据加载失败，请刷新页面。</p>";
    return;
  }

  const $ = (id) => document.getElementById(id);

  const els = {
    originLine: $("originLine"),
    originStation: $("originStation"),
    originSearch: $("originSearch"),
    destLine: $("destLine"),
    destStation: $("destStation"),
    destSearch: $("destSearch"),
    swapBtn: $("swapBtn"),
    calcBtn: $("calcBtn"),
    manualMode: $("manualMode"),
    manualWrap: $("manualWrap"),
    manualKm: $("manualKm"),
    quickChips: $("quickChips"),
    pathTip: $("pathTip"),
    emptyState: $("emptyState"),
    result: $("result"),
    routeFrom: $("routeFrom"),
    routeTo: $("routeTo"),
    routeKm: $("routeKm"),
    routeDetail: $("routeDetail"),
    kmFill: $("kmFill"),
    priceCurrent: $("priceCurrent"),
    priceS1: $("priceS1"),
    priceS2: $("priceS2"),
    delta1: $("delta1"),
    delta2: $("delta2"),
    verdict: $("verdict"),
    pathList: $("pathList"),
    fareTableBody: $("fareTableBody"),
  };

  /* ---------- Fare schemes (2026-08 听证方案) ---------- */
  const PROPOSALS = {
    current: {
      initialPrice: 3,
      initialKm: 6,
      steps: [10, 10],
      tailStartKm: 26,
      tailKm: 10,
    },
    one: {
      initialPrice: 3,
      initialKm: 4,
      steps: [4, 4, 4, 7, 7, 7, 10, 10, 10],
      tailStartKm: 67,
      tailKm: 15,
    },
    two: {
      initialPrice: 4,
      initialKm: 6,
      steps: [6, 8, 8, 10, 10, 12, 12],
      tailStartKm: 72,
      tailKm: 14,
    },
  };

  function fareByProposal(distanceKm, proposal) {
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 0;
    let price = proposal.initialPrice;
    let boundary = proposal.initialKm;
    if (distanceKm <= boundary) return price;
    for (const step of proposal.steps) {
      boundary += step;
      price += 1;
      if (distanceKm <= boundary) return price;
    }
    price += Math.ceil((distanceKm - proposal.tailStartKm) / proposal.tailKm);
    return price;
  }

  // 现行：0–6km 3元，之后每 10km +1元
  function fareCurrent(km) {
    return fareByProposal(km, PROPOSALS.current);
  }

  // 方案一：起乘 3 元 / 4km；加价间距 4,4,4,7,7,7,10,10,10；67km+ 每 15km +1
  function fareScheme1(km) {
    return fareByProposal(km, PROPOSALS.one);
  }

  // 方案二：起乘 4 元 / 6km；加价间距 6,8,8,10,10,12,12；72km+ 每 14km +1
  function fareScheme2(km) {
    return fareByProposal(km, PROPOSALS.two);
  }

  function deltaText(base, val) {
    const d = val - base;
    if (d > 0) return { text: `+${d} 元`, cls: "delta-up" };
    if (d < 0) return { text: `${d} 元`, cls: "delta-down" };
    return { text: "持平", cls: "delta-same" };
  }

  /* ---------- Graph / Dijkstra ---------- */
  const graph = DATA.graph;

  function shortestPath(startNode, endNode) {
    if (startNode === endNode) {
      return { km: 0, nodes: [startNode], edges: [] };
    }
    const dist = Object.create(null);
    const prev = Object.create(null);
    const visited = Object.create(null);
    const pq = [];

    for (const k in graph) dist[k] = Infinity;
    dist[startNode] = 0;
    pq.push([0, startNode]);

    while (pq.length) {
      pq.sort((a, b) => a[0] - b[0]);
      const [d, u] = pq.shift();
      if (visited[u]) continue;
      visited[u] = 1;
      if (u === endNode) break;
      const node = graph[u];
      if (!node) continue;
      for (const e of node.edges) {
        const nd = d + e.km;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = { from: u, km: e.km };
          pq.push([nd, e.to]);
        }
      }
    }

    if (dist[endNode] === Infinity) return null;

    const nodes = [endNode];
    const edges = [];
    let cur = endNode;
    while (cur !== startNode) {
      const p = prev[cur];
      if (!p) return null;
      edges.unshift({ from: p.from, to: cur, km: p.km });
      nodes.unshift(p.from);
      cur = p.from;
    }
    return { km: dist[endNode], nodes, edges };
  }

  function nodeFor(lineId, stationName) {
    const line = DATA.lines.find((l) => l.id === lineId);
    if (!line) return null;
    const idx = line.stations.indexOf(stationName);
    if (idx < 0) return null;
    return `${lineId}|${idx}`;
  }

  /** Prefer any node with this station name (for transfers). */
  function allNodesForStation(name) {
    const nodes = [];
    for (const line of DATA.lines) {
      const idx = line.stations.indexOf(name);
      if (idx >= 0) nodes.push(`${line.id}|${idx}`);
    }
    return nodes;
  }

  function bestPathBetweenStations(fromName, toName, preferFromLine, preferToLine) {
    let starts = allNodesForStation(fromName);
    let ends = allNodesForStation(toName);
    if (preferFromLine) {
      const filtered = starts.filter((n) => n.startsWith(preferFromLine + "|"));
      if (filtered.length) starts = filtered;
    }
    if (preferToLine) {
      const filtered = ends.filter((n) => n.startsWith(preferToLine + "|"));
      if (filtered.length) ends = filtered;
    }
    let best = null;
    for (const s of starts) {
      for (const e of ends) {
        const p = shortestPath(s, e);
        if (p && (!best || p.km < best.km - 0.05)) best = p;
        else if (p && best && Math.abs(p.km - best.km) <= 0.05) {
          const lines = (x) => new Set(x.nodes.map((n) => n.split("|")[0])).size;
          if (lines(p) < lines(best)) best = p;
        }
      }
    }
    return best;
  }

  /* ---------- UI helpers ---------- */
  function fillLines(select) {
    select.innerHTML = "";
    for (const line of DATA.lines) {
      const opt = document.createElement("option");
      opt.value = line.id;
      opt.textContent = `${line.name} · ${line.stations.length}站`;
      select.appendChild(opt);
    }
    // default line 1
    const l1 = DATA.lines.find((l) => l.id === "1") || DATA.lines[0];
    select.value = l1.id;
  }

  function fillStations(lineSelect, stationSelect, searchInput, preferred) {
    const line = DATA.lines.find((l) => l.id === lineSelect.value) || DATA.lines[0];
    const q = (searchInput.value || "").trim().toLowerCase();
    stationSelect.innerHTML = "";
    line.stations.forEach((name, i) => {
      if (q && !name.toLowerCase().includes(q)) return;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      opt.dataset.idx = String(i);
      stationSelect.appendChild(opt);
    });
    if (preferred && line.stations.includes(preferred)) {
      stationSelect.value = preferred;
    } else if (stationSelect.options.length) {
      stationSelect.selectedIndex = 0;
    }
  }

  function setDefaultRoute() {
    // 人民广场-ish commute demo: 莘庄 -> 陆家嘴 if available
    const l1 = DATA.lines.find((l) => l.id === "1");
    const l2 = DATA.lines.find((l) => l.id === "2");
    if (l1 && l2) {
      els.originLine.value = "1";
      fillStations(els.originLine, els.originStation, els.originSearch, "莘庄");
      els.destLine.value = "2";
      fillStations(els.destLine, els.destStation, els.destSearch, "陆家嘴");
      if (els.destStation.value !== "陆家嘴" && l2.stations.includes("陆家嘴")) {
        els.destStation.value = "陆家嘴";
      }
    }
  }

  function renderPath(path) {
    if (!path || !path.nodes.length) {
      els.pathList.innerHTML = "<li>未能找到路径</li>";
      return;
    }
    const parts = [];
    let buf = [];
    let bufLine = null;

    const flush = () => {
      if (!buf.length) return;
      const line = DATA.lines.find((l) => l.id === bufLine);
      const label = line ? line.name : bufLine;
      parts.push(
        `<li><span class="seg">${label}</span>：${buf[0]} → ${buf[buf.length - 1]}（${buf.length} 站）</li>`
      );
      buf = [];
    };

    path.nodes.forEach((n, i) => {
      const [lineId, idxStr] = n.split("|");
      const idx = Number(idxStr);
      const name = graph[n] ? graph[n].name : n;
      if (bufLine !== lineId) {
        flush();
        bufLine = lineId;
        buf = [name];
      } else {
        // transfer at same station name
        if (buf.length && buf[buf.length - 1] !== name) buf.push(name);
        else if (!buf.length) buf.push(name);
      }
      if (i === path.nodes.length - 1) flush();
    });
    // ensure last station appears
    if (!parts.length) flush();
    els.pathList.innerHTML = parts.join("");
  }

  function renderResult(fromName, toName, km, path) {
    els.emptyState.classList.add("hidden");
    els.result.classList.remove("hidden");

    els.routeFrom.textContent = fromName;
    els.routeTo.textContent = toName;
    els.routeKm.textContent = `${km.toFixed(1)} km`;

    const stations = path ? path.nodes.length : 0;
    let transfers = 0;
    if (path && path.nodes.length) {
      let last = path.nodes[0].split("|")[0];
      for (let i = 1; i < path.nodes.length; i++) {
        const cur = path.nodes[i].split("|")[0];
        if (cur !== last) {
          transfers += 1;
          last = cur;
        }
      }
    }
    els.routeDetail.textContent = path
      ? `约 ${Math.max(1, Math.round(km * 2.2 + transfers * 4))} 分钟 · ${transfers} 次换乘`
      : "按输入里程计算";

    // bar: 0-40km scale
    const pct = Math.min(100, (km / 40) * 100);
    els.kmFill.style.width = `${pct}%`;

    const c = fareCurrent(km);
    const s1 = fareScheme1(km);
    const s2 = fareScheme2(km);

    els.priceCurrent.textContent = String(c);
    els.priceS1.textContent = String(s1);
    els.priceS2.textContent = String(s2);

    const d1 = deltaText(c, s1);
    const d2 = deltaText(c, s2);
    els.delta1.textContent = d1.text;
    els.delta1.className = `scheme-note ${d1.cls}`;
    els.delta2.textContent = d2.text;
    els.delta2.className = `scheme-note ${d2.cls}`;

    const monthly = 22;
    let verdictHtml;
    if (s1 === c && s2 === c) {
      verdictHtml = `这段通勤 <strong>三套方案同价 ¥${c}</strong>，调价对你没影响。`;
    } else if (s1 >= c && s2 >= c) {
      const worse = Math.max(s1, s2);
      const bestAlt = Math.min(s1, s2);
      verdictHtml =
        `相对现行，方案一 <strong class="${d1.cls}">${d1.text}</strong>，方案二 <strong class="${d2.cls}">${d2.text}</strong>。` +
        ` 按工作日往返、每月约 ${monthly} 天估算，最贵方案每月约多花 <strong>${((worse - c) * 2 * monthly).toFixed(0)} 元</strong>。`;
    } else {
      verdictHtml =
        `相对现行，方案一 <strong class="${d1.cls}">${d1.text}</strong>，方案二 <strong class="${d2.cls}">${d2.text}</strong>。`;
    }
    els.verdict.innerHTML = verdictHtml;

    renderPath(path);
    els.pathTip.textContent = `已计算：${fromName} → ${toName}，约 ${km.toFixed(1)} 公里。`;
  }

  function calculate() {
    if (els.manualMode.checked) {
      const km = Number(els.manualKm.value);
      if (!(km >= 0)) {
        els.manualKm.focus();
        els.pathTip.textContent = "请输入有效里程（公里）。";
        return;
      }
      renderResult("自定义起点", "自定义终点", km, null);
      return;
    }

    const from = els.originStation.value;
    const to = els.destStation.value;
    if (!from || !to) {
      els.pathTip.textContent = "请先选择出发站和到达站。";
      return;
    }
    if (from === to) {
      els.pathTip.textContent = "出发站与到达站相同，按 0 km 处理。";
      renderResult(from, to, 0, { nodes: allNodesForStation(from).slice(0, 1), edges: [] });
      return;
    }

    const path = bestPathBetweenStations(from, to, els.originLine.value, els.destLine.value);
    if (!path) {
      els.pathTip.textContent = "暂时找不到可达路径，请换一条线路试试。";
      return;
    }
    // floor to 0.1
    const km = Math.round(path.km * 10) / 10;
    renderResult(from, to, km, path);
  }

  function renderFareTable() {
    const rows = [
      3, 5, 6, 8, 10, 12, 15, 16, 18, 20, 24, 26, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90,
    ];
    els.fareTableBody.innerHTML = rows
      .map((km) => {
        const c = fareCurrent(km);
        const s1 = fareScheme1(km);
        const s2 = fareScheme2(km);
        const d = deltaText(c, Math.max(s1, s2));
        return `<tr>
          <td>${km}</td>
          <td>${c}</td>
          <td>${s1}</td>
          <td>${s2}</td>
          <td class="${d.cls}">${d.text}</td>
        </tr>`;
      })
      .join("");
  }

  function renderQuickChips() {
    const pairs = [
      ["莘庄", "陆家嘴"],
      ["人民广场", "虹桥火车站"],
      ["中山公园", "南京东路"],
      ["五角场", "静安寺"],
      ["龙阳路", "滴水湖"],
    ];
    els.quickChips.innerHTML = "";
    pairs.forEach(([a, b]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip";
      btn.textContent = `${a} → ${b}`;
      btn.addEventListener("click", () => {
        // find a line containing a and b
        const path = bestPathBetweenStations(a, b);
        if (!path) return;
        const startNode = path.nodes[0];
        const endNode = path.nodes[path.nodes.length - 1];
        const sl = startNode.split("|")[0];
        const el = endNode.split("|")[0];
        const startName = graph[startNode].name;
        const endName = graph[endNode].name;
        els.originLine.value = sl;
        fillStations(els.originLine, els.originStation, els.originSearch, startName);
        els.destLine.value = el;
        fillStations(els.destLine, els.destStation, els.destSearch, endName);
        calculate();
      });
      els.quickChips.appendChild(btn);
    });
  }

  function bind() {
    els.originLine.addEventListener("change", () => {
      fillStations(els.originLine, els.originStation, els.originSearch, els.originStation.value);
      calculate();
    });
    els.destLine.addEventListener("change", () => {
      fillStations(els.destLine, els.destStation, els.destSearch, els.destStation.value);
      calculate();
    });
    els.originSearch.addEventListener("input", () => {
      fillStations(els.originLine, els.originStation, els.originSearch, null);
    });
    els.destSearch.addEventListener("input", () => {
      fillStations(els.destLine, els.destStation, els.destSearch, null);
    });
    els.originStation.addEventListener("change", calculate);
    els.destStation.addEventListener("change", calculate);
    els.calcBtn.addEventListener("click", calculate);
    els.swapBtn.addEventListener("click", () => {
      const ol = els.originLine.value;
      const os = els.originStation.value;
      els.originLine.value = els.destLine.value;
      fillStations(els.originLine, els.originStation, els.originSearch, els.destStation.value);
      els.destLine.value = ol;
      fillStations(els.destLine, els.destStation, els.destSearch, os);
      calculate();
    });
    els.manualMode.addEventListener("change", () => {
      els.manualWrap.classList.toggle("hidden", !els.manualMode.checked);
      calculate();
    });
    els.manualKm.addEventListener("input", () => {
      if (els.manualMode.checked) calculate();
    });
  }

  function init() {
    fillLines(els.originLine);
    fillLines(els.destLine);
    setDefaultRoute();
    fillStations(els.originLine, els.originStation, els.originSearch, els.originStation.value);
    fillStations(els.destLine, els.destStation, els.destSearch, els.destStation.value);
    bind();
    renderFareTable();
    renderQuickChips();
    // auto first result
    calculate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
