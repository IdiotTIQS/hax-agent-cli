"use strict";

/**
 * svg-gen — generates self-contained SVG diagrams from structured data.
 *
 * All functions return complete, standalone SVG strings that can be embedded
 * in HTML, saved as .svg files, or passed to rendering engines.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val));
}

function _colors(index) {
  const PALETTE = [
    { fill: "#3B82F6", stroke: "#2563EB" },   // blue
    { fill: "#10B981", stroke: "#059669" },   // green
    { fill: "#F59E0B", stroke: "#D97706" },   // amber
    { fill: "#EF4444", stroke: "#DC2626" },   // red
    { fill: "#8B5CF6", stroke: "#7C3AED" },   // purple
    { fill: "#EC4899", stroke: "#DB2777" },   // pink
    { fill: "#06B6D4", stroke: "#0891B2" },   // cyan
    { fill: "#F97316", stroke: "#EA580C" },   // orange
    { fill: "#14B8A6", stroke: "#0D9488" },   // teal
    { fill: "#6366F1", stroke: "#4F46E5" },   // indigo
  ];
  return PALETTE[_clamp(index, 0, PALETTE.length - 1)];
}

function _svgWrap(body, width, height) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    body,
    "</svg>",
  ].join("\n");
}

function _textX(align, x, width) {
  if (align === "middle" || align === "center") return x + width / 2;
  if (align === "end") return x + width;
  return x + 4;
}

function _textAnchor(align) {
  if (align === "middle" || align === "center") return "middle";
  if (align === "end") return "end";
  return "start";
}

function _sanitizeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ---------------------------------------------------------------------------
// SVG Bar Chart
// ---------------------------------------------------------------------------

/**
 * Generate an SVG bar chart.
 *
 * @param {object} data
 * @param {Array<{label:string, value:number}>} data.bars — bar entries
 * @param {object} [options]
 * @param {number} [options.width=600] — SVG width
 * @param {number} [options.height=400] — SVG height
 * @param {string} [options.title] — chart title
 * @param {string} [options.orientation="vertical"] — "vertical" or "horizontal"
 * @returns {string} complete SVG string
 */
function generateBarChart(data, options) {
  options = options || {};
  const bars = Array.isArray(data) ? data : (Array.isArray(data.bars) ? data.bars : []);
  const width = options.width || 600;
  const height = options.height || 400;
  const title = options.title || "";
  const orientation = options.orientation || "vertical";

  if (orientation === "horizontal") {
    return _barChartHorizontal(bars, width, height, title);
  }
  return _barChartVertical(bars, width, height, title);
}

function _barChartVertical(bars, width, height, title) {
  const margin = { top: title ? 50 : 20, right: 30, bottom: 50, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const maxVal = Math.max(...bars.map(b => b.value), 1);
  const barCount = bars.length;
  const barGap = Math.max(4, Math.floor(chartW / barCount / 4));
  const barWidth = Math.max(10, Math.floor((chartW - barGap * (barCount + 1)) / barCount));

  let svg = "";

  // Title
  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  // Y-axis line
  svg += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartH}" stroke="#D1D5DB" stroke-width="1"/>\n`;

  // X-axis line
  svg += `<line x1="${margin.left}" y1="${margin.top + chartH}" x2="${margin.left + chartW}" y2="${margin.top + chartH}" stroke="#D1D5DB" stroke-width="1"/>\n`;

  // Y-axis ticks and grid lines
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    const y = margin.top + chartH - (i / tickCount) * chartH;
    const val = Math.round((i / tickCount) * maxVal);
    svg += `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#6B7280">${val}</text>\n`;
    if (i > 0) {
      svg += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartW}" y2="${y}" stroke="#F3F4F6" stroke-width="1"/>\n`;
    }
  }

  // Bars
  for (let i = 0; i < bars.length; i++) {
    const x = margin.left + barGap + i * (barWidth + barGap);
    const barH = Math.max(1, (bars[i].value / maxVal) * chartH);
    const y = margin.top + chartH - barH;
    const col = _colors(i);

    svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1" rx="2"/>\n`;

    // Value label
    svg += `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#374151">${bars[i].value}</text>\n`;

    // X-axis label
    const label = String(bars[i].label || "").slice(0, 10);
    svg += `<text x="${x + barWidth / 2}" y="${margin.top + chartH + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#6B7280">${_sanitizeXml(label)}</text>\n`;
  }

  return _svgWrap(svg, width, height);
}

function _barChartHorizontal(bars, width, height, title) {
  const margin = { top: title ? 50 : 20, right: 60, bottom: 20, left: 100 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const maxVal = Math.max(...bars.map(b => b.value), 1);
  const barCount = bars.length;
  const barGap = Math.max(2, Math.floor(chartH / barCount / 4));
  const barHeight = Math.max(14, Math.floor((chartH - barGap * (barCount + 1)) / barCount));

  let svg = "";

  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  // Axes
  svg += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartH}" stroke="#D1D5DB" stroke-width="1"/>\n`;
  svg += `<line x1="${margin.left}" y1="${margin.top + chartH}" x2="${margin.left + chartW}" y2="${margin.top + chartH}" stroke="#D1D5DB" stroke-width="1"/>\n`;

  for (let i = 0; i < bars.length; i++) {
    const y = margin.top + barGap + i * (barHeight + barGap);
    const barW = Math.max(1, (bars[i].value / maxVal) * chartW);
    const col = _colors(i);

    // Label
    const label = String(bars[i].label || "").slice(0, 15);
    svg += `<text x="${margin.left - 8}" y="${y + barHeight / 2 + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#374151">${_sanitizeXml(label)}</text>\n`;

    // Bar
    svg += `<rect x="${margin.left}" y="${y}" width="${barW}" height="${barHeight}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1" rx="2"/>\n`;

    // Value
    svg += `<text x="${margin.left + barW + 6}" y="${y + barHeight / 2 + 4}" text-anchor="start" font-family="sans-serif" font-size="10" fill="#374151">${bars[i].value}</text>\n`;
  }

  return _svgWrap(svg, width, height);
}

// ---------------------------------------------------------------------------
// SVG Line Chart
// ---------------------------------------------------------------------------

/**
 * Generate an SVG line chart.
 *
 * @param {object} data
 * @param {Array<number>} data.series — array of y-values
 * @param {object} [options]
 * @param {number} [options.width=600] — SVG width
 * @param {number} [options.height=400] — SVG height
 * @param {string} [options.title] — chart title
 * @param {Array<string>} [options.labels] — x-axis labels
 * @param {boolean} [options.showPoints=true] — draw data point circles
 * @param {boolean} [options.showArea=false] — fill area under line
 * @returns {string} complete SVG string
 */
function generateLineChart(data, options) {
  options = options || {};
  const series = Array.isArray(data) ? data : (Array.isArray(data.series) ? data.series : []);
  const width = options.width || 600;
  const height = options.height || 400;
  const title = options.title || "";
  const labels = Array.isArray(options.labels) ? options.labels : [];
  const showPoints = options.showPoints !== false;
  const showArea = options.showArea === true;

  if (series.length === 0) {
    return _svgWrap(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9CA3AF">No data</text>`,
      width,
      height
    );
  }

  const margin = { top: title ? 50 : 20, right: 30, bottom: 50, left: 60 };
  const chartW = width - margin.left - margin.right;
  const chartH = height - margin.top - margin.bottom;

  const maxVal = Math.max(...series, 1);
  const minVal = Math.min(...series, 0);
  const range = maxVal - minVal || 1;
  const stepX = series.length > 1 ? chartW / (series.length - 1) : chartW;

  let svg = "";

  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  // Axes
  svg += `<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartH}" stroke="#D1D5DB" stroke-width="1"/>\n`;
  svg += `<line x1="${margin.left}" y1="${margin.top + chartH}" x2="${margin.left + chartW}" y2="${margin.top + chartH}" stroke="#D1D5DB" stroke-width="1"/>\n`;

  // Y-axis ticks
  const tickCount = 5;
  for (let i = 0; i <= tickCount; i++) {
    const y = margin.top + chartH - (i / tickCount) * chartH;
    const val = Math.round(minVal + (i / tickCount) * range);
    svg += `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="11" fill="#6B7280">${val}</text>\n`;
    if (i > 0) {
      svg += `<line x1="${margin.left}" y1="${y}" x2="${margin.left + chartW}" y2="${y}" stroke="#F3F4F6" stroke-width="1"/>\n`;
    }
  }

  // Line path
  let pathD = "";
  for (let i = 0; i < series.length; i++) {
    const x = margin.left + (series.length === 1 ? chartW / 2 : i * stepX);
    const y = margin.top + chartH - ((series[i] - minVal) / range) * chartH;
    pathD += (i === 0 ? "M" : "L") + ` ${x} ${y}`;
  }

  // Area fill
  if (showArea) {
    const firstX = margin.left + (series.length === 1 ? chartW / 2 : 0);
    const lastX = margin.left + (series.length === 1 ? chartW / 2 : (series.length - 1) * stepX);
    const bottomY = margin.top + chartH;
    const areaD = pathD + ` L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
    svg += `<path d="${areaD}" fill="#3B82F6" fill-opacity="0.1"/>\n`;
  }

  svg += `<path d="${pathD}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linejoin="round"/>\n`;

  // Data points
  if (showPoints) {
    for (let i = 0; i < series.length; i++) {
      const x = margin.left + (series.length === 1 ? chartW / 2 : i * stepX);
      const y = margin.top + chartH - ((series[i] - minVal) / range) * chartH;
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="#3B82F6" stroke="#FFFFFF" stroke-width="1.5"/>\n`;
      // Value label
      svg += `<text x="${x}" y="${y - 8}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#374151">${series[i]}</text>\n`;
    }
  }

  // X-axis labels
  if (labels.length > 0) {
    for (let i = 0; i < labels.length && i < series.length; i++) {
      const x = margin.left + (series.length === 1 ? chartW / 2 : i * stepX);
      const lbl = String(labels[i] || "").slice(0, 12);
      svg += `<text x="${x}" y="${margin.top + chartH + 16}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#6B7280">${_sanitizeXml(lbl)}</text>\n`;
    }
  }

  return _svgWrap(svg, width, height);
}

// ---------------------------------------------------------------------------
// SVG Pie Chart
// ---------------------------------------------------------------------------

/**
 * Generate an SVG pie chart.
 *
 * @param {object} data
 * @param {Array<{label:string, value:number}>} data.slices — pie slices
 * @param {object} [options]
 * @param {number} [options.width=500] — SVG width
 * @param {number} [options.height=400] — SVG height
 * @param {string} [options.title] — chart title
 * @param {boolean} [options.showLabels=true] — draw slice labels
 * @param {boolean} [options.donut=false] — render as donut chart
 * @returns {string} complete SVG string
 */
function generatePieChart(data, options) {
  options = options || {};
  const slices = Array.isArray(data) ? data : (Array.isArray(data.slices) ? data.slices : []);
  const width = options.width || 500;
  const height = options.height || 400;
  const title = options.title || "";
  const showLabels = options.showLabels !== false;
  const donut = options.donut === true;

  if (slices.length === 0) {
    return _svgWrap(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9CA3AF">No data</text>`,
      width,
      height
    );
  }

  const total = slices.reduce((s, sl) => s + (sl.value || 0), 0);
  if (total === 0) {
    return _svgWrap(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9CA3AF">Total is zero</text>`,
      width,
      height
    );
  }

  const cx = width / 2;
  const cy = (title ? 50 : 0) + (height - (title ? 50 : 0)) / 2;
  const radius = Math.min(cx, cy) - 40;
  const innerRadius = donut ? radius * 0.55 : 0;

  let svg = "";

  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  let currentAngle = -Math.PI / 2;

  for (let i = 0; i < slices.length; i++) {
    const sliceAngle = (slices[i].value / total) * 2 * Math.PI;
    const endAngle = currentAngle + sliceAngle;
    const col = _colors(i);

    // Arc path
    const x1 = cx + radius * Math.cos(currentAngle);
    const y1 = cy + radius * Math.sin(currentAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArc = sliceAngle > Math.PI ? 1 : 0;

    if (innerRadius > 0) {
      // Donut segment
      const ix1 = cx + innerRadius * Math.cos(currentAngle);
      const iy1 = cy + innerRadius * Math.sin(currentAngle);
      const ix2 = cx + innerRadius * Math.cos(endAngle);
      const iy2 = cy + innerRadius * Math.sin(endAngle);

      const d = [
        `M ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
        `L ${ix2} ${iy2}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1}`,
        "Z",
      ].join(" ");

      svg += `<path d="${d}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
    } else {
      // Pie segment
      const d = [
        `M ${cx} ${cy}`,
        `L ${x1} ${y1}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
        "Z",
      ].join(" ");

      svg += `<path d="${d}" fill="${col.fill}" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
    }

    // Label
    if (showLabels) {
      const midAngle = currentAngle + sliceAngle / 2;
      const labelRadius = radius * 1.15;
      const lx = cx + labelRadius * Math.cos(midAngle);
      const ly = cy + labelRadius * Math.sin(midAngle);
      const pct = ((slices[i].value / total) * 100).toFixed(1);
      const lbl = `${String(slices[i].label || "").slice(0, 12)} ${pct}%`;

      svg += `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#374151">${_sanitizeXml(lbl)}</text>\n`;
    }

    currentAngle = endAngle;
  }

  return _svgWrap(svg, width, height);
}

// ---------------------------------------------------------------------------
// SVG Flow Diagram
// ---------------------------------------------------------------------------

/**
 * Generate an SVG flow / graph diagram.
 *
 * @param {Array<{id:string, label:string, x?:number, y?:number, shape?:string}>} nodes — diagram nodes
 * @param {Array<{from:string, to:string, label?:string}>} edges — diagram edges
 * @param {object} [options]
 * @param {number} [options.width=800] — SVG width
 * @param {number} [options.height=600] — SVG height
 * @param {string} [options.title] — diagram title
 * @param {string} [options.layout="top-down"] — "top-down" or "left-right"
 * @returns {string} complete SVG string
 */
function generateFlowDiagram(nodes, edges, options) {
  options = options || {};
  const width = options.width || 800;
  const height = options.height || 600;
  const title = options.title || "";
  const layout = options.layout || "top-down";

  if (!Array.isArray(nodes) || nodes.length === 0) {
    return _svgWrap(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9CA3AF">No nodes</text>`,
      width,
      height
    );
  }

  const margin = { top: title ? 50 : 20, right: 20, bottom: 20, left: 20 };
  const availW = width - margin.left - margin.right;
  const availH = height - margin.top - margin.bottom;

  // Auto-layout: simple grid
  const nodeCount = nodes.length;
  const cols = layout === "left-right" ? 1 : Math.ceil(Math.sqrt(nodeCount * (availW / availH)));
  const rows = Math.ceil(nodeCount / cols);
  const cellW = availW / cols;
  const cellH = availH / Math.max(1, rows);

  const nodeMap = {};
  for (let i = 0; i < nodes.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const nx = layout === "left-right" ? margin.left + 20 : margin.left + col * cellW + cellW / 2;
    const ny = layout === "left-right" ? margin.top + row * (availH / rows) + (availH / rows) / 2 : margin.top + row * cellH + cellH / 2;
    nodeMap[nodes[i].id] = {
      ...nodes[i],
      _x: nodes[i].x !== undefined ? nodes[i].x : nx,
      _y: nodes[i].y !== undefined ? nodes[i].y : ny,
    };
  }

  const edgeList = Array.isArray(edges) ? edges : [];

  let svg = "";

  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  // Draw edges first (behind nodes)
  const defMarkers = [
    '<defs>',
    '<marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">',
    '<polygon points="0 0, 10 3.5, 0 7" fill="#9CA3AF"/>',
    '</marker>',
    '</defs>',
  ].join("\n");
  svg += defMarkers + "\n";

  for (let i = 0; i < edgeList.length; i++) {
    const from = nodeMap[edgeList[i].from];
    const to = nodeMap[edgeList[i].to];
    if (!from || !to) continue;

    const fx = from._x;
    const fy = from._y;
    const tx = to._x;
    const ty = to._y;

    // Simple straight line
    svg += `<line x1="${fx}" y1="${fy + 20}" x2="${tx}" y2="${ty - 20}" stroke="#9CA3AF" stroke-width="1.5" marker-end="url(#arrowhead)"/>\n`;

    if (edgeList[i].label) {
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2 - 6;
      svg += `<text x="${mx}" y="${my}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#6B7280">${_sanitizeXml(edgeList[i].label)}</text>\n`;
    }
  }

  // Draw nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodeMap[nodes[i].id];
    const col = _colors(i);
    const shape = n.shape || "box";
    const boxW = 100;
    const boxH = 40;

    switch (shape) {
      case "diamond":
      case "decision":
        svg += `<polygon points="${n._x},${n._y - 25} ${n._x + 40},${n._y} ${n._x},${n._y + 25} ${n._x - 40},${n._y}" fill="${col.fill}" fill-opacity="0.15" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
        svg += `<text x="${n._x}" y="${n._y + 4}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#1F2937">${_sanitizeXml(n.label || n.id)}</text>\n`;
        break;
      case "rounded":
      case "process":
        svg += `<rect x="${n._x - boxW / 2}" y="${n._y - boxH / 2}" width="${boxW}" height="${boxH}" rx="8" fill="${col.fill}" fill-opacity="0.15" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
        svg += `<text x="${n._x}" y="${n._y + 4}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#1F2937">${_sanitizeXml(n.label || n.id)}</text>\n`;
        break;
      case "ellipse":
      case "start":
      case "end":
        svg += `<ellipse cx="${n._x}" cy="${n._y}" rx="${boxW / 2}" ry="${boxH / 2}" fill="${col.fill}" fill-opacity="0.15" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
        svg += `<text x="${n._x}" y="${n._y + 4}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#1F2937">${_sanitizeXml(n.label || n.id)}</text>\n`;
        break;
      default: // box/rectangle
        svg += `<rect x="${n._x - boxW / 2}" y="${n._y - boxH / 2}" width="${boxW}" height="${boxH}" rx="3" fill="${col.fill}" fill-opacity="0.15" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
        svg += `<text x="${n._x}" y="${n._y + 4}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#1F2937">${_sanitizeXml(n.label || n.id)}</text>\n`;
        break;
    }
  }

  return _svgWrap(svg, width, height);
}

// ---------------------------------------------------------------------------
// SVG Architecture Diagram
// ---------------------------------------------------------------------------

/**
 * Generate a simple architecture diagram showing components and their connections.
 *
 * @param {Array<{name:string, type?:string, dependsOn?:string[], description?:string}>} components — architectural components
 * @param {object} [options]
 * @param {number} [options.width=800] — SVG width
 * @param {number} [options.height=600] — SVG height
 * @param {string} [options.title] — diagram title
 * @returns {string} complete SVG string
 */
function generateArchitectureDiagram(components, options) {
  options = options || {};
  const width = options.width || 800;
  const height = options.height || 600;
  const title = options.title || "";

  if (!Array.isArray(components) || components.length === 0) {
    return _svgWrap(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9CA3AF">No components</text>`,
      width,
      height
    );
  }

  const margin = { top: title ? 60 : 30, right: 30, bottom: 30, left: 30 };
  const availW = width - margin.left - margin.right;
  const availH = height - margin.top - margin.bottom;

  // Tiered layout by type
  const tiers = { client: 0, gateway: 0, frontend: 0, service: 1, backend: 1, database: 2, queue: 1, cache: 1, external: 2 };
  const layered = {};
  for (const comp of components) {
    const tier = tiers[comp.type] !== undefined ? tiers[comp.type] : 1;
    if (!layered[tier]) layered[tier] = [];
    layered[tier].push(comp);
  }

  const layerKeys = Object.keys(layered).sort((a, b) => a - b);
  const layerCount = Math.max(1, layerKeys.length);
  const layerH = availH / layerCount;
  const layerNames = ["Client / Frontend", "Services / Middleware", "Data / External"];

  // Build component positions
  const compMap = {};
  for (let li = 0; li < layerKeys.length; li++) {
    const layer = layered[layerKeys[li]];
    const itemW = availW / Math.max(1, layer.length);
    for (let ci = 0; ci < layer.length; ci++) {
      compMap[layer[ci].name] = {
        ...layer[ci],
        _x: margin.left + ci * itemW + itemW / 2,
        _y: margin.top + li * layerH + layerH / 2,
        _w: Math.min(140, itemW - 20),
        _h: Math.min(60, layerH - 20),
      };
    }
  }

  let svg = "";

  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  // Layer backgrounds and labels
  const layerColors = ["#EFF6FF", "#F0FDF4", "#FEFCE8"];
  const layerBorder = ["#BFDBFE", "#BBF7D0", "#FDE68A"];
  for (let li = 0; li < layerKeys.length; li++) {
    const lx = margin.left;
    const ly = margin.top + li * layerH;
    svg += `<rect x="${lx}" y="${ly + 5}" width="${availW}" height="${layerH - 10}" rx="8" fill="${layerColors[li % layerColors.length]}" stroke="${layerBorder[li % layerBorder.length]}" stroke-width="1" stroke-dasharray="4,2"/>\n`;
    svg += `<text x="${lx + 10}" y="${ly + 18}" font-family="sans-serif" font-size="10" fill="#9CA3AF" font-weight="bold">${layerNames[li] || `Layer ${li + 1}`}</text>\n`;
  }

  // Draw dependency arrows
  const defComp = [
    '<defs>',
    '<marker id="compArrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">',
    '<polygon points="0 0, 8 3, 0 6" fill="#D1D5DB"/>',
    '</marker>',
    '</defs>',
  ].join("\n");
  svg += defComp + "\n";

  for (let i = 0; i < components.length; i++) {
    const comp = compMap[components[i].name];
    if (!comp) continue;
    const deps = Array.isArray(components[i].dependsOn) ? components[i].dependsOn : [];
    for (const depName of deps) {
      const dep = compMap[depName];
      if (!dep) continue;
      svg += `<line x1="${comp._x}" y1="${comp._y}" x2="${dep._x}" y2="${dep._y}" stroke="#D1D5DB" stroke-width="1.5" marker-end="url(#compArrow)"/>\n`;
    }
  }

  // Draw component boxes
  for (let i = 0; i < components.length; i++) {
    const comp = compMap[components[i].name];
    if (!comp) continue;
    const col = _colors(i);

    svg += `<rect x="${comp._x - comp._w / 2}" y="${comp._y - comp._h / 2}" width="${comp._w}" height="${comp._h}" rx="6" fill="${col.fill}" fill-opacity="0.12" stroke="${col.stroke}" stroke-width="1.5"/>\n`;
    svg += `<text x="${comp._x}" y="${comp._y - 2}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#1F2937">${_sanitizeXml(comp.name)}</text>\n`;

    const typeLabel = comp.type ? comp.type : "";
    svg += `<text x="${comp._x}" y="${comp._y + 14}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#6B7280">${_sanitizeXml(typeLabel)}</text>\n`;

    if (comp.description) {
      const desc = String(comp.description).slice(0, 30);
      svg += `<text x="${comp._x}" y="${comp._y + 26}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#9CA3AF">${_sanitizeXml(desc)}</text>\n`;
    }
  }

  return _svgWrap(svg, width, height);
}

// ---------------------------------------------------------------------------
// SVG Heat Map
// ---------------------------------------------------------------------------

/**
 * Generate an SVG heatmap.
 *
 * @param {object} data
 * @param {Array<Array<number>>} data.matrix — 2D array of numeric values
 * @param {object} [options]
 * @param {number} [options.width=600] — SVG width
 * @param {number} [options.height=400] — SVG height
 * @param {string} [options.title] — chart title
 * @param {Array<string>} [options.rowLabels] — row labels
 * @param {Array<string>} [options.colLabels] — column labels
 * @param {Array<string>} [options.colorScale] — CSS color stops for gradient
 * @returns {string} complete SVG string
 */
function generateHeatMap(data, options) {
  options = options || {};
  const matrix = Array.isArray(data) ? data : (Array.isArray(data.matrix) ? data.matrix : []);
  const width = options.width || 600;
  const height = options.height || 400;
  const title = options.title || "";
  const rowLabels = Array.isArray(options.rowLabels) ? options.rowLabels : [];
  const colLabels = Array.isArray(options.colLabels) ? options.colLabels : [];
  const colorScale = Array.isArray(options.colorScale) && options.colorScale.length > 0
    ? options.colorScale
    : ["#EFF6FF", "#BFDBFE", "#3B82F6", "#1D4ED8"];

  if (matrix.length === 0 || !Array.isArray(matrix[0]) || matrix[0].length === 0) {
    return _svgWrap(
      `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9CA3AF">No data</text>`,
      width,
      height
    );
  }

  const rows = matrix.length;
  const cols = Math.max(...matrix.map(r => Array.isArray(r) ? r.length : 0));

  // Flatten and find range
  let flat = [];
  for (const row of matrix) {
    if (Array.isArray(row)) flat = flat.concat(row);
  }
  const maxVal = Math.max(...flat, 1);
  const minVal = Math.min(...flat, 0);
  const range = maxVal - minVal || 1;

  const margin = { top: title ? 60 : 20, right: 30, bottom: 40, left: 80 };
  const cellW = (width - margin.left - margin.right) / cols;
  const cellH = (height - margin.top - margin.bottom) / rows;

  // Simple color interpolation
  function _heatColor(value) {
    const t = (value - minVal) / range; // 0..1
    const idx = t * (colorScale.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, colorScale.length - 1);
    const frac = idx - lo;
    return lo === hi ? colorScale[lo] : _lerpColor(colorScale[lo], colorScale[hi], frac);
  }

  function _lerpColor(c1, c2, t) {
    const r1 = parseInt(c1.slice(1, 3), 16);
    const g1 = parseInt(c1.slice(3, 5), 16);
    const b1 = parseInt(c1.slice(5, 7), 16);
    const r2 = parseInt(c2.slice(1, 3), 16);
    const g2 = parseInt(c2.slice(3, 5), 16);
    const b2 = parseInt(c2.slice(5, 7), 16);
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  let svg = "";

  if (title) {
    svg += `<text x="${width / 2}" y="30" text-anchor="middle" font-family="sans-serif" font-size="16" font-weight="bold" fill="#1F2937">${_sanitizeXml(title)}</text>\n`;
  }

  // Cells
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = matrix[r] && matrix[r][c] !== undefined ? matrix[r][c] : 0;
      const x = margin.left + c * cellW;
      const y = margin.top + r * cellH;
      const color = _heatColor(val);

      svg += `<rect x="${x}" y="${y}" width="${cellW - 2}" height="${cellH - 2}" rx="2" fill="${color}"/>\n`;

      // Cell value text (contrasted)
      const brightness = _getBrightness(color);
      const textColor = brightness > 140 ? "#1F2937" : "#FFFFFF";
      svg += `<text x="${x + cellW / 2 - 1}" y="${y + cellH / 2 + 3}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="${textColor}">${val}</text>\n`;
    }
  }

  // Row labels
  for (let r = 0; r < rows; r++) {
    const lbl = rowLabels[r] || `Row ${r + 1}`;
    const y = margin.top + r * cellH + cellH / 2 + 3;
    svg += `<text x="${margin.left - 6}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#6B7280">${_sanitizeXml(String(lbl).slice(0, 12))}</text>\n`;
  }

  // Column labels
  for (let c = 0; c < cols; c++) {
    const lbl = colLabels[c] || `Col ${c + 1}`;
    const x = margin.left + c * cellW + cellW / 2 - 1;
    svg += `<text x="${x}" y="${margin.top + rows * cellH + 14}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#6B7280">${_sanitizeXml(String(lbl).slice(0, 10))}</text>\n`;
  }

  // Legend
  const legendY = margin.top + rows * cellH + 24;
  const legendW = 120;
  for (let i = 0; i < colorScale.length; i++) {
    const lx = margin.left + i * (legendW / colorScale.length);
    svg += `<rect x="${lx}" y="${legendY}" width="${legendW / colorScale.length}" height="12" fill="${colorScale[i]}"/>\n`;
  }
  svg += `<text x="${margin.left}" y="${legendY + 8}" text-anchor="start" font-family="sans-serif" font-size="8" fill="#6B7280">${minVal}</text>\n`;
  svg += `<text x="${margin.left + legendW}" y="${legendY + 8}" text-anchor="end" font-family="sans-serif" font-size="8" fill="#6B7280">${maxVal}</text>\n`;

  return _svgWrap(svg, width, height);
}

function _getBrightness(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  generateBarChart,
  generateLineChart,
  generatePieChart,
  generateFlowDiagram,
  generateArchitectureDiagram,
  generateHeatMap,
};
