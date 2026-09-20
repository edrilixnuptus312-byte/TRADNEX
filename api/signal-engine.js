export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const twelveKey = process.env.TWELVE_DATA_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!twelveKey) {
    return res.status(500).json({
      error: "TWELVE_DATA_API_KEY is not configured"
    });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      error: "Supabase server credentials are not configured"
    });
  }

  const symbol = req.query.symbol || "XAU/USD";

  try {
    // =========================================================
    // GET COMPLETED 4H + 15M CANDLES
    // =========================================================

    const [h4Response, m15Response] = await Promise.all([
      fetch(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
          symbol
        )}&interval=4h&outputsize=10&order=desc&timezone=UTC&apikey=${encodeURIComponent(
          twelveKey
        )}`
      ),

      fetch(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
          symbol
        )}&interval=15min&outputsize=20&order=desc&timezone=UTC&apikey=${encodeURIComponent(
          twelveKey
        )}`
      )
    ]);

    const h4Data = await h4Response.json();
    const m15Data = await m15Response.json();

    if (h4Data.status === "error") {
      return res.status(502).json({
        error: "Twelve Data 4H request failed",
        details: h4Data
      });
    }

    if (m15Data.status === "error") {
      return res.status(502).json({
        error: "Twelve Data 15M request failed",
        details: m15Data
      });
    }

    const h4 = h4Data.values || [];
    const m15 = m15Data.values || [];

    if (h4.length < 3 || m15.length < 2) {
      return res.status(502).json({
        error: "Not enough market data"
      });
    }

    // =========================================================
    // IMPORTANT:
    // Twelve Data returns newest candles first.
    //
    // h4[0] = current/latest 4H candle
    // h4[1] = most recent completed 4H candle
    // h4[2] = previous 4H candle
    // =========================================================

    const current4H = h4[0];
    const completed4H = h4[1];
    const previous4H = h4[2];

    // =========================================================
    // TRADNEX CORE 4H SETUP
    //
    // BUY:
    // completed 4H closes ABOVE previous 4H high
    //
    // SELL:
    // completed 4H closes BELOW previous 4H low
    //
    // The completed 4H closing price becomes the key level.
    // =========================================================

    const completedClose = Number(completed4H.close);
    const previousHigh = Number(previous4H.high);
    const previousLow = Number(previous4H.low);

    let direction = null;
    let keyLevel = null;

    if (completedClose > previousHigh) {
      direction = "BUY";
      keyLevel = completedClose;
    } else if (completedClose < previousLow) {
      direction = "SELL";
      keyLevel = completedClose;
    }

    // =========================================================
    // 15M BODY CONFIRMATION
    //
    // BUY:
    // 15M candle BODY closes above the 4H key level
    //
    // SELL:
    // 15M candle BODY closes below the 4H key level
    // =========================================================

    const completed15M = m15[1];
    const previous15M = m15[2];

    const close15M = Number(completed15M.close);
    const previousClose15M = Number(previous15M.close);

    let confirmation = false;

    if (direction === "BUY") {
      confirmation =
        close15M > keyLevel &&
        previousClose15M <= keyLevel;
    }

    if (direction === "SELL") {
      confirmation =
        close15M < keyLevel &&
        previousClose15M >= keyLevel;
    }

    // =========================================================
    // NO SIGNAL
    // =========================================================

    if (!direction || !confirmation) {
      return res.status(200).json({
        signal: null,
        symbol,
        strategy: "TRADNEX 4H → 15M",
        status: "NO_SIGNAL",
        analysis: {
          current4H,
          completed4H,
          previous4H,
          completed15M,
          direction,
          keyLevel,
          confirmation
        }
      });
    }

    // =========================================================
    // PREVENT DUPLICATE SIGNALS
    // =========================================================

    const signalTime = completed15M.datetime;

    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/signals?symbol=eq.${encodeURIComponent(
        symbol
      )}&created_at=gte.${encodeURIComponent(
        new Date(`${signalTime}Z`).toISOString()
      )}&select=id&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const existingSignals = await existingResponse.json();

    if (Array.isArray(existingSignals) && existingSignals.length > 0) {
      return res.status(200).json({
        signal: null,
        symbol,
        strategy: "TRADNEX 4H → 15M",
        status: "ALREADY_RECORDED",
        signalTime
      });
    }

    // =========================================================
    // CREATE REAL TRADNEX SIGNAL
    //
    // No fake/demo signal is inserted.
    // This is created only after the actual 4H + 15M
    // conditions are satisfied.
    // =========================================================

    const signal = {
      symbol,
      direction,
      timeframe: "15M",
      entry: close15M,
      stop_loss: null,
      take_profit: null,
      status: "ACTIVE",
      message: `TRADNEX ${direction} confirmation`,
      confidence: null,
      setup: "4H → 15M",
      signal_reason:
        direction === "BUY"
          ? "Completed 4H candle closed above previous 4H high, then completed 15M candle body closed above the 4H closing level."
          : "Completed 4H candle closed below previous 4H low, then completed 15M candle body closed below the 4H closing level."
    };

    const insertResponse = await fetch(
      `${supabaseUrl}/rest/v1/signals`,
      {
        method: "POST",
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify(signal)
      }
    );

    const inserted = await insertResponse.json();

    if (!insertResponse.ok) {
      return res.status(500).json({
        error: "Failed to save signal",
        details: inserted
      });
    }

    return res.status(200).json({
      signal: inserted[0] || signal,
      symbol,
      strategy: "TRADNEX 4H → 15M",
      status: "SIGNAL_CREATED"
    });

  } catch (error) {
    return res.status(500).json({
      error: "Signal engine failed",
      details: error.message
    });
  }
}
