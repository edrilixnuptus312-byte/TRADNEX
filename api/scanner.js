export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  /*
   * =========================================================
   * TRADNEX MULTI-MARKET SCANNER
   *
   * Every symbol is checked using the SAME:
   *
   * 4H → 15M TRADNEX strategy
   *
   * No separate strategy is used for different markets.
   * =========================================================
   */

  const symbols = [
    // GOLD
    "XAU/USD",

    // BITCOIN
    "BTC/USD",

    // FOREX
    "EUR/USD",
    "GBP/USD",
    "USD/JPY",
    "USD/CHF",
    "USD/CAD",
    "AUD/USD",
    "NZD/USD",

    "EUR/GBP",
    "EUR/JPY",
    "EUR/CHF",
    "EUR/AUD",
    "EUR/CAD",
    "EUR/NZD",

    "GBP/JPY",
    "GBP/CHF",
    "GBP/AUD",
    "GBP/CAD",
    "GBP/NZD",

    "AUD/JPY",
    "AUD/CAD",
    "AUD/CHF",
    "AUD/NZD",

    "CAD/JPY",
    "CAD/CHF",

    "CHF/JPY",

    "NZD/JPY",
    "NZD/CAD",
    "NZD/CHF"
  ];

  /*
   * =========================================================
   * FIND THE LIVE TRADNEX URL
   * =========================================================
   */

  const baseUrl =
    process.env.TRADNEX_BASE_URL ||
    "https://tradnex.vercel.app";

  const results = [];

  /*
   * =========================================================
   * SCAN EACH MARKET
   *
   * Sequential scanning keeps the requests controlled.
   * =========================================================
   */

  for (const symbol of symbols) {
    try {
      const url =
        `${baseUrl}/api/signal-engine?symbol=` +
        encodeURIComponent(symbol);

      const response = await fetch(url);

      let data;

      try {
        data = await response.json();
      } catch {
        data = {
          error: "Invalid response from signal engine"
        };
      }

      results.push({
        symbol,
        httpStatus: response.status,
        status: data.status || "UNKNOWN",
        signal: data.signal || null,
        confidence:
          data.confidence ??
          data.signal?.confidence ??
          null,
        signalTime:
          data.signalTime ??
          data.signal?.message ??
          null
      });

    } catch (error) {
      results.push({
        symbol,
        httpStatus: 500,
        status: "ERROR",
        signal: null,
        confidence: null,
        error: error.message
      });
    }
  }

  /*
   * =========================================================
   * FIND REAL SIGNALS
   * =========================================================
   */

  const signals = results.filter(
    item =>
      item.signal &&
      (
        item.status === "SIGNAL_CREATED" ||
        item.status === "ALREADY_RECORDED"
      )
  );

  /*
   * =========================================================
   * FINAL RESPONSE
   * =========================================================
   */

  return res.status(200).json({
    scanner: "TRADNEX MULTI-MARKET SCANNER",

    strategy: "TRADNEX 4H → 15M",

    status:
      signals.length > 0
        ? "SIGNALS_FOUND"
        : "NO_SIGNALS",

    marketsScanned: symbols.length,

    signalsFound: signals.length,

    signals,

    results,

    scannedAt: new Date().toISOString()
  });
}
