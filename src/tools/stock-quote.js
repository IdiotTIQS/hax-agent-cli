"use strict";

const https = require("node:https");
const http = require("node:http");
const { ToolExecutionError } = require("./error");
const { requireString } = require("./utils");

const DEFAULT_TIMEOUT_MS = 10_000;

// Known index/stock name → code mappings
const KNOWN_SYMBOLS = {
  "上证指数": "sh000001", "上证": "sh000001", "sh000001": "sh000001",
  "深证成指": "sz399001", "深成指": "sz399001", "sz399001": "sz399001",
  "创业板指": "sz399006", "创业板": "sz399006", "sz399006": "sz399006",
  "沪深300": "sh000300", "sh000300": "sh000300",
  "科创50": "sh000688", "sh000688": "sh000688",
  "S&P 500": "^GSPC", "标普500": "^GSPC", "标普": "^GSPC",
  "NASDAQ": "^IXIC", "纳斯达克": "^IXIC",
  "DJIA": "^DJI", "道琼斯": "^DJI", "道指": "^DJI",
};

function createStockQuoteTool() {
  return {
    name: "stock.quote",
    description: "Get real-time stock/index quotes. Supports Chinese A-shares (sh/sz codes), HK stocks, and US stocks. Returns current price, change, volume, and day range.",
    inputSchema: {
      type: "object",
      required: ["symbol"],
      properties: {
        symbol: { type: "string", description: "Stock symbol (e.g. sh000001, AAPL, 上证指数, 000001 for shenzhen)" },
        timeoutMs: { type: "number", description: "HTTP timeout in ms", default: DEFAULT_TIMEOUT_MS },
      },
    },
    async execute(args) {
      const symbol = requireString(args.symbol, "symbol").trim();
      const timeoutMs = typeof args.timeoutMs === "number" ? args.timeoutMs : DEFAULT_TIMEOUT_MS;

      const resolvedSymbol = KNOWN_SYMBOLS[symbol] || symbol;

      if (resolvedSymbol.startsWith("sh") || resolvedSymbol.startsWith("sz")) {
        return await fetchSinaChinese(resolvedSymbol, timeoutMs);
      }
      if (/^\d{6}$/.test(resolvedSymbol)) {
        const shResult = await fetchSinaChinese(`sh${resolvedSymbol}`, timeoutMs);
        if (shResult && !shResult.error) return shResult;
        return await fetchSinaChinese(`sz${resolvedSymbol}`, timeoutMs);
      }
      if (resolvedSymbol.startsWith("^") || /^[A-Z]{1,5}$/.test(resolvedSymbol)) {
        return await fetchYahooUS(resolvedSymbol, timeoutMs);
      }
      return await fetchYahooUS(resolvedSymbol, timeoutMs);
    },
  };
}

async function fetchSinaChinese(code, timeoutMs) {
  return new Promise((resolve) => {
    const url = `https://hq.sinajs.cn/list=${code}`;
    const req = https.get(url, {
      headers: { Referer: "https://finance.sina.com.cn" },
      timeout: timeoutMs,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const match = data.match(/"([^"]+)"/);
          if (!match) {
            resolve({ symbol: code, error: "Could not parse stock data", source: "Sina Finance" });
            return;
          }
          const fields = match[1].split(",");
          if (fields.length < 6) {
            resolve({ symbol: code, error: "Incomplete data from Sina", source: "Sina Finance" });
            return;
          }
          const name = fields[0];
          const currentPrice = parseFloat(fields[3]);
          const yesterdayClose = parseFloat(fields[2]);
          const open = parseFloat(fields[1]);
          const high = parseFloat(fields[4]);
          const low = parseFloat(fields[5]);
          const change = currentPrice - yesterdayClose;
          const changePercent = yesterdayClose > 0 ? (change / yesterdayClose * 100) : 0;
          const volume = parseInt(fields[8], 10) || 0;

          resolve({
            symbol: code,
            name,
            price: currentPrice,
            change: Math.round(change * 100) / 100,
            changePercent: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
            open, high, low,
            yesterdayClose,
            volume: formatVolume(volume),
            source: "Sina Finance",
            updatedAt: `${fields[30] || ""} ${fields[31] || ""}`.trim(),
          });
        } catch (err) {
          resolve({ symbol: code, error: `Parse error: ${err.message}`, source: "Sina Finance" });
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ symbol: code, error: "Request timed out", source: "Sina Finance" }); });
    req.on("error", (err) => { resolve({ symbol: code, error: `Request failed: ${err.message}`, source: "Sina Finance" }); });
  });
}

async function fetchYahooUS(symbol, timeoutMs) {
  return new Promise((resolve) => {
    const encodedSymbol = encodeURIComponent(symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=1d`;

    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          const result = json?.chart?.result?.[0];
          if (!result) {
            resolve({ symbol, error: "No data from Yahoo Finance", source: "Yahoo Finance" });
            return;
          }
          const meta = result.meta || {};
          const quote = result.indicators?.quote?.[0] || {};
          const currentPrice = meta.regularMarketPrice;
          const previousClose = meta.previousClose || meta.chartPreviousClose;
          const change = currentPrice - previousClose;
          const changePercent = previousClose > 0 ? (change / previousClose * 100) : 0;

          resolve({
            symbol: meta.symbol || symbol,
            name: meta.shortName || meta.symbol || symbol,
            price: currentPrice,
            change: Math.round(change * 100) / 100,
            changePercent: `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(2)}%`,
            open: quote.open?.[0] || meta.regularMarketOpen,
            high: meta.regularMarketDayHigh || quote.high?.[0],
            low: meta.regularMarketDayLow || quote.low?.[0],
            yesterdayClose: previousClose,
            volume: formatVolume(meta.regularMarketVolume || 0),
            source: "Yahoo Finance",
            currency: meta.currency || "USD",
          });
        } catch (err) {
          resolve({ symbol, error: `Parse error: ${err.message}`, source: "Yahoo Finance" });
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ symbol, error: "Request timed out", source: "Yahoo Finance" }); });
    req.on("error", (err) => { resolve({ symbol, error: `Request failed: ${err.message}`, source: "Yahoo Finance" }); });
  });
}

function formatVolume(volume) {
  if (!volume || volume === 0) return "0";
  if (volume >= 1e8) return `${(volume / 1e8).toFixed(2)}亿`;
  if (volume >= 1e4) return `${(volume / 1e4).toFixed(2)}万`;
  return String(volume);
}

module.exports = { createStockQuoteTool };
