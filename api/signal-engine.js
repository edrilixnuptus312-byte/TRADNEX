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
    // GET MARKET DATA
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
        )}&interval=15min&outputsize=30&order=desc&timezone=UTC&apikey=${encodeURIComponent(
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

    if (h4.length < 3 || m15.length < 3) {
      return res.status(502).json({
        error: "Not enough market data"
      });
    }

    // =========================================================
    // TWELVE DATA RETURNS NEWEST FIRST
    //
    // h4[0] = current/in-progress 4H candle
    // h4[1] = latest completed 4H candle
    // h4[2] = previous completed 4H candle
    //
    // m15[0] = current/in-progress 15M candle
    // m15[1] = latest completed 15M candle
    // m15[2] = previous completed 15M candle
    // =========================================================

    const current4H = h4[0];
    const completed4H = h4[1];
    const previous4H = h4[2];

    const completed15M = m15[1];
    const previous15M = m15[2];

    // =========================================================
    // NUMERIC VALUES
    // =========================================================

    const completed4HOpen = Number(completed4H.open);
    const completed4HClose = Number(completed4H.close);

    const previous4HHigh = Number(previous4H.high);
    const previous4HLow = Number(previous4H.low);

    const completed15MOpen = Number(completed15M.open);
    const completed15MClose = Number(completed15M.close);

    if (
      !Number.isFinite(completed4HOpen) ||
      !Number.isFinite(completed4HClose) ||
      !Number.isFinite(previous4HHigh) ||
      !Number.isFinite(previous4HLow) ||
      !Number.isFinite(completed15MOpen) ||
      !Number.isFinite(completed15MClose)
    ) {
      return res.status(502).json({
        error: "Invalid market data received"
      });
    }

    // =========================================================
    // TRADNEX 4H SETUP
    //
    // BUY:
    // Completed 4H candle closes ABOVE previous 4H high.
    //
    // SELL:
    // Completed 4H candle closes BELOW previous 4H low.
    //
    // The completed 4H CLOSE becomes the key level.
    // =========================================================

    let direction = null;
    let keyLevel = null;

    if (completed4HClose > previous4HHigh) {
      direction = "BUY";
      keyLevel = completed4HClose;
    } else if (completed4HClose < previous4HLow) {
      direction = "SELL";
      keyLevel = completed4HClose;
    }

    // =========================================================
    // 15M BODY CONFIRMATION
    //
    // BUY:
    // 15M BODY closes above the 4H key level.
    //
    // SELL:
    // 15M BODY closes below the 4H key level.
    //
    // Previous 15M close must have been on/below the level
    // for BUY, or on/above the level for SELL.
    // =========================================================

    let confirmation = false;

    if (direction === "BUY") {
      confirmation =
        completed15MClose > keyLevel &&
        Number(previous15M.close) <= keyLevel;
    }

    if (direction === "SELL") {
      confirmation =
        completed15MClose < keyLevel &&
        Number(previous15M.close) >= keyLevel;
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
          previous15M,
          direction,
          keyLevel,
          confirmation
        }
      });
    }

    // =========================================================
    // SIGNAL CONFIRMATION TIME
    // =========================================================

    const signalTime = completed15M.datetime;

    const signalDate = new Date(`${signalTime}Z`);

    if (Number.isNaN(signalDate.getTime())) {
      return res.status(500).json({
        error: "Invalid signal timestamp"
      });
    }

    // =========================================================
    // PREVENT DUPLICATE SIGNALS
    //
    // The confirmation candle itself identifies the signal.
    // =========================================================

    const existingResponse = await fetch(
      `${supabaseUrl}/rest/v1/signals?symbol=eq.${encodeURIComponent(
        symbol
      )}&timeframe=eq.15M&message=like.*${encodeURIComponent(
        signalTime
      )}*&select=id&limit=1`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      }
    );

    const existingSignals = await existingResponse.json();

    if (
      Array.isArray(existingSignals) &&
      existingSignals.length > 0
    ) {
      return res.status(200).json({
        signal: null,
        symbol,
        strategy: "TRADNEX 4H → 15M",
        status: "ALREADY_RECORDED",
        signalTime
      });
    }

    // =========================================================
    // OBJECTIVE CONFIDENCE
    //
    // Confidence is NOT a prediction of profitability.
    // It measures how strongly the actual setup satisfies
    // the defined TRADNEX conditions.
    // =========================================================

    const breakoutDistance =
      Math.abs(completed4HClose -
        (direction === "BUY"
          ? previous4HHigh
          : previous4HLow));

    const confirmationDistance =
      Math.abs(completed15MClose - keyLevel);

    const previous4HRange =
      previous4HHigh - previous4HLow;

    let confidence = 70;

    if (previous4HRange > 0) {
      const breakoutStrength =
        breakoutDistance / previous4HRange;

      if (breakoutStrength >= 0.50) {
        confidence += 10;
      } else if (breakoutStrength >= 0.25) {
        confidence += 5;
      }
    }

    const confirmationBody =
      Math.abs(completed15MClose - completed15MOpen);

    if (confirmationBody > 0) {
      const confirmationStrength =
        confirmationDistance / confirmationBody;

      if (confirmationStrength >= 1) {
        confidence += 10;
      } else if (confirmationStrength >= 0.50) {
        confidence += 5;
      }
    }

    confidence = Math.min(95, Math.max(70, confidence));

    // =========================================================
    // REAL SIGNAL
    //
    // NO FAKE SL/TP.
    // User sets SL/TP manually.
    // =========================================================

    const signal = {
      symbol,
      direction,
      timeframe: "15M",

      entry: completed15MClose,

      stop_loss: null,
      take_profit: null,

      status: "ACTIVE",

      message:
        `TRADNEX ${direction} confirmation | ${signalTime}`,

      confidence,

      setup: "4H → 15M",

      signal_reason:
        direction === "BUY"
          ? "Completed 4H candle closed above the previous 4H high. The completed 4H closing price became the key level, and the completed 15M candle body closed above that level."
          : "Completed 4H candle closed below the previous 4H low. The completed 4H closing price became the key level, and the completed 15M candle body closed below that level."
    };

    // =========================================================
    // SAVE REAL SIGNAL TO SUPABASE
    // =========================================================

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

    // =========================================================
    // RETURN REAL SIGNAL
    // =========================================================

    return res.status(200).json({
      signal: inserted[0] || signal,

      symbol,

      strategy: "TRADNEX 4H → 15M",

      status: "SIGNAL_CREATED",

      confidence,

      signalTime,

      market: {
        completed4H,
        previous4H,
        completed15M,
        previous15M
      }
    });

  } catch (error) {
    return res.status(500).json({
      error: "Signal engine failed",
      details: error.message
    });
  }
}
