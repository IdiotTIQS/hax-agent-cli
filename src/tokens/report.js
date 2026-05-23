"use strict";

/**
 * TokenReport — generates token usage and cost reports.
 * All methods accept plain data objects (CostTracker session output format)
 * for testability. Each method returns a structured report object exportable
 * as text, markdown, or JSON.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundCost(value) {
  return Math.round(value * 10000) / 10000;
}

function formatCost(n) {
  return `$${n.toFixed(4)}`;
}

function formatNumber(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function toISODate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Report serializers
// ---------------------------------------------------------------------------

function textReport(sections) {
  let out = "";
  for (const section of sections) {
    if (out) out += "\n";
    if (section.title) {
      out += `${section.title}\n${"=".repeat(section.title.length)}\n\n`;
    }
    if (section.kv) {
      for (const [k, v] of Object.entries(section.kv)) {
        out += `${k}: ${v}\n`;
      }
    }
    if (section.lines) {
      for (const line of section.lines) {
        out += `${line}\n`;
      }
    }
    if (section.table) {
      const { headers, rows } = section.table;
      const widths = headers.map((h, i) =>
        Math.max(h.length, ...rows.map((r) => String(r[i] || "").length))
      );
      // Header.
      out += headers.map((h, i) => h.padEnd(widths[i])).join("  ") + "\n";
      out += headers.map((h, i) => "-".repeat(widths[i])).join("  ") + "\n";
      // Rows.
      for (const row of rows) {
        out += row.map((c, i) => String(c || "").padEnd(widths[i])).join("  ") + "\n";
      }
    }
  }
  return out;
}

function mdReport(sections) {
  let out = "";
  for (const section of sections) {
    if (out) out += "\n";
    if (section.title) {
      out += `## ${section.title}\n\n`;
    }
    if (section.kv) {
      for (const [k, v] of Object.entries(section.kv)) {
        out += `- **${k}:** ${v}\n`;
      }
      out += "\n";
    }
    if (section.lines) {
      for (const line of section.lines) {
        out += `${line}\n`;
      }
      out += "\n";
    }
    if (section.table) {
      const { headers, rows } = section.table;
      out += "| " + headers.join(" | ") + " |\n";
      out += "|" + headers.map(() => "---").join("|") + "|\n";
      for (const row of rows) {
        out += "| " + row.join(" | ") + " |\n";
      }
      out += "\n";
    }
  }
  return out.trimEnd();
}

// ---------------------------------------------------------------------------
// TokenReport
// ---------------------------------------------------------------------------

class TokenReport {
  constructor(options = {}) {
    this._reportTitle = options.title || "Token Usage Report";
  }

  /**
   * Generate a per-session usage report.
   * @param {object} session - CostTracker.getSessionCost() output.
   * @returns {object} { text, markdown, json } exports.
   */
  generateUsageReport(session) {
    const s = session || {};
    const byModel = s.byModel || {};
    const byProvider = s.byProvider || {};

    const lines = [];
    lines.push(`Session: ${s.sessionName || "unknown"}`);
    lines.push(`Duration: ${(s.sessionDurationMinutes || 0).toFixed(1)} min`);
    lines.push(`Total Calls: ${s.totalCalls || 0}`);
    lines.push(`Total Tokens: ${formatNumber(s.totalTokens || 0)} (in: ${formatNumber(s.totalInputTokens || 0)}, out: ${formatNumber(s.totalOutputTokens || 0)})`);
    lines.push(`Total Cost: ${formatCost(s.totalCost || 0)}`);
    lines.push(`Budget: ${formatCost(s.totalCost || 0)} / ${formatCost(s.budgetLimit || 0)} (${s.budgetUsedPercent || 0}%)`);
    lines.push(`Avg Cost/Call: ${formatCost(s.costPerCall || 0)}`);
    lines.push(`Cost/Min: ${formatCost(s.costPerMinute || 0)}`);
    lines.push(`Alerts: ${s.alerts || 0}`);
    lines.push("");

    const modelRows = Object.values(byModel).map((m) => [
      m.model, m.provider, String(m.calls), formatNumber(m.totalTokens), formatCost(m.totalCost),
    ]);

    const sections = [
      {
        title: "Per-Session Usage Report",
        kv: {
          "Session": s.sessionName || "unknown",
          "Duration": `${(s.sessionDurationMinutes || 0).toFixed(1)} min`,
          "Total Calls": String(s.totalCalls || 0),
          "Total Tokens": `${formatNumber(s.totalTokens || 0)} (${formatNumber(s.totalInputTokens || 0)} in / ${formatNumber(s.totalOutputTokens || 0)} out)`,
          "Total Cost": formatCost(s.totalCost || 0),
          "Budget Used": `${formatCost(s.totalCost || 0)} / ${formatCost(s.budgetLimit || 0)} (${s.budgetUsedPercent || 0}%)`,
          "Avg Cost/Call": formatCost(s.costPerCall || 0),
          "Cost/Minute": formatCost(s.costPerMinute || 0),
          "Alerts Fired": String(s.alerts || 0),
        },
        lines,
        table: modelRows.length > 0 ? {
          headers: ["Model", "Provider", "Calls", "Tokens", "Cost"],
          rows: modelRows,
        } : null,
      },
    ];

    const sectionsClean = sections.filter((sec) => sec !== null);

    return {
      session: s,
      text: textReport(sectionsClean),
      markdown: mdReport(sectionsClean),
      json: JSON.stringify(s, null, 2),
    };
  }

  /**
   * Generate a cost analysis across multiple sessions.
   * @param {Array<object>} sessions - Array of CostTracker.getSessionCost() outputs.
   * @returns {object} { text, markdown, json } exports.
   */
  generateCostReport(sessions) {
    const sList = Array.isArray(sessions) ? sessions : [];
    if (sList.length === 0) {
      const empty = "No session data available.";
      return { text: empty, markdown: empty, json: "[]", summary: null };
    }

    const totalCost = roundCost(sList.reduce((s, ses) => s + (ses.totalCost || 0), 0));
    const totalTokens = sList.reduce((s, ses) => s + (ses.totalTokens || 0), 0);
    const totalCalls = sList.reduce((s, ses) => s + (ses.totalCalls || 0), 0);
    const totalInputTokens = sList.reduce((s, ses) => s + (ses.totalInputTokens || 0), 0);
    const totalOutputTokens = sList.reduce((s, ses) => s + (ses.totalOutputTokens || 0), 0);

    const avgCostPerSession = sList.length > 0 ? totalCost / sList.length : 0;
    const avgTokensPerSession = sList.length > 0 ? totalTokens / sList.length : 0;

    // Provider aggregation.
    const providerCosts = {};
    const modelCosts = {};
    for (const ses of sList) {
      const byProvider = ses.byProvider || {};
      for (const [name, data] of Object.entries(byProvider)) {
        if (!providerCosts[name]) providerCosts[name] = { cost: 0, calls: 0, tokens: 0 };
        providerCosts[name].cost = roundCost(providerCosts[name].cost + (data.totalCost || 0));
        providerCosts[name].calls += data.calls || 0;
        providerCosts[name].tokens += data.totalTokens || 0;
      }
      const byModel = ses.byModel || {};
      for (const [name, data] of Object.entries(byModel)) {
        if (!modelCosts[name]) modelCosts[name] = { cost: 0, calls: 0, tokens: 0 };
        modelCosts[name].cost = roundCost(modelCosts[name].cost + (data.totalCost || 0));
        modelCosts[name].calls += data.calls || 0;
        modelCosts[name].tokens += data.totalTokens || 0;
      }
    }

    // Most expensive session.
    const mostExpensive = sList.reduce(
      (max, s) => ((s.totalCost || 0) > (max.totalCost || 0) ? s : max),
      sList[0]
    );

    // Per-session table rows.
    const sessionRows = sList.map((s, i) => [
      s.sessionName || `Session ${i + 1}`,
      formatCost(s.totalCost || 0),
      formatNumber(s.totalTokens || 0),
      String(s.totalCalls || 0),
      `${(s.budgetUsedPercent || 0)}%`,
    ]);

    // Model breakdown.
    const modelRows = Object.entries(modelCosts)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([name, d]) => [name, formatCost(d.cost), String(d.calls), formatNumber(d.tokens)]);

    // Provider breakdown.
    const providerRows = Object.entries(providerCosts)
      .sort((a, b) => b[1].cost - a[1].cost)
      .map(([name, d]) => [name, formatCost(d.cost), String(d.calls), formatNumber(d.tokens)]);

    const sections = [
      {
        title: "Cost Analysis Report",
        kv: {
          "Sessions Analyzed": String(sList.length),
          "Total Cost": formatCost(totalCost),
          "Total Tokens": formatNumber(totalTokens),
          "Total Calls": String(totalCalls),
          "Input Tokens": formatNumber(totalInputTokens),
          "Output Tokens": formatNumber(totalOutputTokens),
          "Avg Cost/Session": formatCost(avgCostPerSession),
          "Avg Tokens/Session": formatNumber(Math.round(avgTokensPerSession)),
          "Most Expensive Session": `${mostExpensive ? mostExpensive.sessionName || "?" : "N/A"} (${formatCost(mostExpensive ? mostExpensive.totalCost || 0 : 0)})`,
        },
      },
      {
        title: "Session Breakdown",
        table: {
          headers: ["Session", "Cost", "Tokens", "Calls", "Budget%"],
          rows: sessionRows,
        },
      },
      {
        title: "Model Breakdown",
        table: {
          headers: ["Model", "Cost", "Calls", "Tokens"],
          rows: modelRows,
        },
      },
      {
        title: "Provider Breakdown",
        table: {
          headers: ["Provider", "Cost", "Calls", "Tokens"],
          rows: providerRows,
        },
      },
    ];

    const summary = {
      sessionCount: sList.length,
      totalCost,
      totalTokens,
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      providerCosts,
      modelCosts,
    };

    return {
      summary,
      text: textReport(sections),
      markdown: mdReport(sections),
      json: JSON.stringify(summary, null, 2),
    };
  }

  /**
   * Generate an efficiency analysis across sessions.
   * @param {Array<object>} sessions - Array of CostTracker.getSessionCost() outputs.
   * @returns {object} { text, markdown, json } exports.
   */
  generateEfficiencyReport(sessions) {
    const sList = Array.isArray(sessions) ? sessions : [];
    if (sList.length === 0) {
      const empty = "No session data available.";
      return { text: empty, markdown: empty, json: "{}", summary: null };
    }

    const metrics = sList.map((s, i) => {
      const inputTokens = s.totalInputTokens || 0;
      const outputTokens = s.totalOutputTokens || 0;
      const totalTokens = s.totalTokens || 0;
      const totalCost = s.totalCost || 0;
      const calls = s.totalCalls || 1;

      const outputInputRatio = inputTokens > 0 ? outputTokens / inputTokens : 0;
      const tokensPerCall = totalTokens / calls;
      const costPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;
      const costPerCall = totalCost / calls;

      return {
        sessionName: s.sessionName || `Session ${i + 1}`,
        inputTokens,
        outputTokens,
        totalTokens,
        totalCost,
        calls,
        outputInputRatio: roundCost(outputInputRatio),
        tokensPerCall: Math.round(tokensPerCall),
        costPerToken: roundCost(costPerToken),
        costPerCall: roundCost(costPerCall),
      };
    });

    const avgOutputInputRatio = metrics.length > 0
      ? roundCost(metrics.reduce((s, m) => s + m.outputInputRatio, 0) / metrics.length)
      : 0;
    const avgTokensPerCall = metrics.length > 0
      ? Math.round(metrics.reduce((s, m) => s + m.tokensPerCall, 0) / metrics.length)
      : 0;
    const avgCostPerToken = metrics.length > 0
      ? roundCost(metrics.reduce((s, m) => s + m.costPerToken, 0) / metrics.length)
      : 0;

    // Identify inefficient sessions (high output/input ratio).
    const inefficient = metrics
      .filter((m) => m.outputInputRatio > 1.0)
      .sort((a, b) => b.outputInputRatio - a.outputInputRatio);

    // Identify efficient sessions (low output/input ratio).
    const efficient = metrics
      .filter((m) => m.outputInputRatio <= 0.5)
      .sort((a, b) => a.outputInputRatio - b.outputInputRatio);

    let efficiencyScore = "Good";
    if (avgOutputInputRatio > 1.5) efficiencyScore = "Poor";
    else if (avgOutputInputRatio > 1.0) efficiencyScore = "Needs Improvement";
    else if (avgOutputInputRatio > 0.5) efficiencyScore = "Fair";

    const metricRows = metrics.map((m) => [
      m.sessionName,
      formatNumber(m.totalTokens),
      String(m.calls),
      m.outputInputRatio.toFixed(2),
      String(m.tokensPerCall),
      formatCost(m.costPerCall),
    ]);

    const sections = [
      {
        title: "Efficiency Analysis Report",
        kv: {
          "Sessions Analyzed": String(sList.length),
          "Avg Output/Input Ratio": avgOutputInputRatio.toFixed(2),
          "Avg Tokens/Call": String(avgTokensPerCall),
          "Avg Cost/Token": formatCost(avgCostPerToken),
          "Efficiency Score": efficiencyScore,
          "Inefficient Sessions": `${inefficient.length} (ratio > 1.0)`,
          "Efficient Sessions": `${efficient.length} (ratio <= 0.5)`,
        },
      },
      {
        title: "Per-Session Efficiency",
        table: {
          headers: ["Session", "Tokens", "Calls", "O/I Ratio", "Toks/Call", "Cost/Call"],
          rows: metricRows,
        },
      },
    ];

    if (inefficient.length > 0) {
      sections.push({
        title: "Inefficient Sessions (High Output Ratio)",
        lines: inefficient.slice(0, 5).map((m) =>
          `- ${m.sessionName}: ratio ${m.outputInputRatio.toFixed(2)}, cost ${formatCost(m.totalCost)}`
        ),
      });
    }

    if (efficient.length > 0) {
      sections.push({
        title: "Most Efficient Sessions (Low Output Ratio)",
        lines: efficient.slice(0, 5).map((m) =>
          `- ${m.sessionName}: ratio ${m.outputInputRatio.toFixed(2)}, cost ${formatCost(m.totalCost)}`
        ),
      });
    }

    const summary = {
      sessionCount: sList.length,
      avgOutputInputRatio,
      avgTokensPerCall,
      avgCostPerToken,
      efficiencyScore,
      inefficientCount: inefficient.length,
      efficientCount: efficient.length,
    };

    return {
      summary,
      text: textReport(sections),
      markdown: mdReport(sections),
      json: JSON.stringify(summary, null, 2),
    };
  }

  /**
   * Generate a cost/usage forecast projection.
   * @param {Array<object>} history - Array of daily usage objects { date, cost, tokens, calls }.
   * @param {number} days - Number of days to forecast.
   * @returns {object} { text, markdown, json } exports.
   */
  generateForecast(history, days) {
    const hist = Array.isArray(history) ? history : [];
    const forecastDays = Math.max(1, Math.floor(Number(days) || 30));

    if (hist.length === 0) {
      const empty = "No history data available for forecast.";
      return { text: empty, markdown: empty, json: "{}", summary: null };
    }

    // Compute daily averages from history.
    const totalCost = hist.reduce((s, h) => s + (h.cost || 0), 0);
    const totalTokens = hist.reduce((s, h) => s + (h.tokens || 0), 0);
    const totalCalls = hist.reduce((s, h) => s + (h.calls || 0), 0);

    const daysInHistory = hist.length;
    const avgDailyCost = daysInHistory > 0 ? totalCost / daysInHistory : 0;
    const avgDailyTokens = daysInHistory > 0 ? totalTokens / daysInHistory : 0;
    const avgDailyCalls = daysInHistory > 0 ? Math.round(totalCalls / daysInHistory) : 0;

    // Linear trend (simple linear regression on cost).
    let slope = 0;
    if (hist.length >= 2) {
      const n = hist.length;
      const xMean = (n - 1) / 2;
      const yMean = totalCost / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        const x = i;
        const y = hist[i].cost || 0;
        num += (x - xMean) * (y - yMean);
        den += (x - xMean) * (x - xMean);
      }
      slope = den !== 0 ? num / den : 0;
    }

    // Projections.
    const projectedCost = roundCost(avgDailyCost * forecastDays);
    const projectedTokens = Math.round(avgDailyTokens * forecastDays);
    const projectedCalls = avgDailyCalls * forecastDays;

    // With trend.
    const lastDay = hist.length;
    const projectedWithTrend = roundCost(
      hist.reduce((s, h, i) => {
        const dayOffset = lastDay + i;
        return s + ((h.cost || 0) + slope * (dayOffset - i));
      }, 0) / hist.length * forecastDays
    );

    // Simple forecast table.
    const forecastRows = [];
    const intervals = Math.min(forecastDays, 12);
    const step = Math.max(1, Math.floor(forecastDays / intervals));
    for (let d = step; d <= forecastDays; d += step) {
      forecastRows.push([
        `${d} days`,
        formatCost(roundCost(avgDailyCost * d)),
        formatNumber(Math.round(avgDailyTokens * d)),
        String(Math.round(avgDailyCalls * d)),
      ]);
    }
    // Ensure the final day is included.
    if (forecastRows.length === 0 || !forecastRows[forecastRows.length - 1][0].startsWith(String(forecastDays))) {
      forecastRows.push([
        `${forecastDays} days`,
        formatCost(projectedCost),
        formatNumber(projectedTokens),
        String(projectedCalls),
      ]);
    }

    const trendWord = slope > 0.001 ? "upward" : slope < -0.001 ? "downward" : "flat";
    const trendColor = slope > 0.001 ? "increasing" : slope < -0.001 ? "decreasing" : "stable";

    const sections = [
      {
        title: `Cost & Usage Forecast (${forecastDays} days)`,
        kv: {
          "History Days": String(daysInHistory),
          "Avg Daily Cost": formatCost(avgDailyCost),
          "Avg Daily Tokens": formatNumber(Math.round(avgDailyTokens)),
          "Avg Daily Calls": String(avgDailyCalls),
          "Cost Trend": `${trendWord} (slope: ${formatCost(roundCost(slope))}/day)`,
          "Projected Cost (flat)": formatCost(projectedCost),
          "Projected Cost (trend)": formatCost(projectedWithTrend),
          "Projected Tokens": formatNumber(projectedTokens),
          "Projected Calls": String(projectedCalls),
        },
      },
      {
        title: "Cumulative Forecast",
        table: {
          headers: ["Timeframe", "Cost", "Tokens", "Calls"],
          rows: forecastRows,
        },
      },
    ];

    const summary = {
      historyDays: daysInHistory,
      forecastDays,
      avgDailyCost: roundCost(avgDailyCost),
      avgDailyTokens: Math.round(avgDailyTokens),
      avgDailyCalls,
      costTrend: trendColor,
      costSlope: roundCost(slope),
      projectedCost: roundCost(projectedCost),
      projectedCostWithTrend: projectedWithTrend,
      projectedTokens,
      projectedCalls,
    };

    return {
      summary,
      text: textReport(sections),
      markdown: mdReport(sections),
      json: JSON.stringify(summary, null, 2),
    };
  }
}

module.exports = { TokenReport };
