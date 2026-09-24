export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const symbols = [
    "XAU/USD",

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
    "NZD/CHF",

    "BTC/USD"
  ];

  try {
    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host =
      req.headers.host;

    const baseUrl =
      `${protocol}://${host}`;

    // =========================================================
    // SCAN ALL TRADNEX INSTRUMENTS
    // =========================================================

    const results = await Promise.all(
      symbols.map(async (symbol) => {

        try {
          const response = await fetch(
            `${baseUrl}/api/signal-engine?symbol=${encodeURIComponent(
              symbol
            )}`
          );

          const data = await response.json();

          return {
            symbol,
            status: response.ok
              ? data.status || "UNKNOWN"
              : "ERROR",
            signal: data.signal || null,
            confidence:
              data.confidence ?? null,
            signalTime:
              data.signalTime || null
          };

        } catch (error) {
          return {
            symbol,
            status: "ERROR",
            signal: null,
            confidence: null,
            signalTime: null,
            error: error.message
          };
        }
      })
    );

    // =========================================================
    // ONLY REAL SIGNALS
    // =========================================================

    const liveSignals =
      results.filter(
        item =>
          item.status === "SIGNAL_CREATED" &&
          item.signal
      );

    // =========================================================
    // SUMMARY
    // =========================================================

    return res.status(200).json({
      scanner: "TRADNEX LIVE SCANNER",
      strategy: "4H → 15M",
      scanned: symbols.length,
      signalsFound: liveSignals.length,

      timestamp:
        new Date().toISOString(),

      signals: liveSignals,

      markets: results
    });

  } catch (error) {
    return res.status(500).json({
      error: "Scanner failed",
      details: error.message
    });
  }
}
