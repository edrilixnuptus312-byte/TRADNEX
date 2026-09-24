export default async function handler(req, res) {

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    // =========================================================
    // BUILD THE CURRENT TRADNEX API URL
    // =========================================================

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host =
      req.headers.host;

    const baseUrl =
      `${protocol}://${host}`;

    // =========================================================
    // RUN THE OFFICIAL TRADNEX SIGNAL ENGINE
    // =========================================================
    //
    // signal-engine already contains the official TRADNEX
    // market universe.
    //
    // We use all=true so scanner does not maintain a second
    // symbol list.
    //
    // Strategy remains:
    // 4H → 15M
    //
    // =========================================================

    const response = await fetch(
      `${baseUrl}/api/signal-engine?all=true`
    );

    let data;

    try {
      data = await response.json();
    } catch {
      return res.status(502).json({
        scanner: "TRADNEX LIVE SCANNER",
        error: "Invalid response from signal engine"
      });
    }

    // =========================================================
    // SIGNAL ENGINE ERROR
    // =========================================================

    if (!response.ok) {
      return res.status(response.status).json({
        scanner: "TRADNEX LIVE SCANNER",
        strategy: "TRADNEX 4H → 15M",
        status: "ERROR",
        error: "Signal engine request failed",
        details: data
      });
    }

    // =========================================================
    // READ MARKET RESULTS
    // =========================================================

    const results =
      Array.isArray(data.results)
        ? data.results
        : [];

    // =========================================================
    // ONLY RETURN ACTUALLY CREATED SIGNALS
    // =========================================================
    //
    // No demo signals.
    // No generated/fake signals.
    //
    // A signal must have been created by the real signal engine.
    //
    // =========================================================

    const liveSignals =
      results.filter(
        item =>
          item &&
          item.status === "SIGNAL_CREATED" &&
          item.signal
      );

    // =========================================================
    // FINAL SCANNER RESPONSE
    // =========================================================

    return res.status(200).json({

      scanner:
        "TRADNEX LIVE SCANNER",

      strategy:
        "TRADNEX 4H → 15M",

      status:
        liveSignals.length > 0
          ? "SIGNALS_FOUND"
          : "NO_SIGNALS",

      scanned:
        data.scanned ?? results.length,

      signalsFound:
        liveSignals.length,

      signals:
        liveSignals,

      markets:
        results,

      timestamp:
        new Date().toISOString()

    });

  } catch (error) {

    return res.status(500).json({

      scanner:
        "TRADNEX LIVE SCANNER",

      strategy:
        "TRADNEX 4H → 15M",

      status:
        "ERROR",

      error:
        error.message

    });

  }

}
