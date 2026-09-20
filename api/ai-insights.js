export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const twelveKey = process.env.TWELVE_DATA_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!twelveKey) {
    return res.status(500).json({
      error: "TWELVE_DATA_API_KEY is not configured"
    });
  }

  if (!openaiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured"
    });
  }

  const symbol = req.query.symbol || "XAU/USD";

  try {
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

    if (h4.length < 3 || m15.length < 3) {
      return res.status(502).json({
        error: "Not enough market data"
      });
    }

    const completed4H = h4[1];
    const previous4H = h4[2];

    const completed15M = m15[1];
    const previous15M = m15[2];

    const completed4HClose = Number(completed4H.close);
    const previous4HHigh = Number(previous4H.high);
    const previous4HLow = Number(previous4H.low);

    let tradnexDirection = "NEUTRAL";
    let keyLevel = null;

    if (completed4HClose > previous4HHigh) {
      tradnexDirection = "BUY";
      keyLevel = completed4HClose;
    }

    if (completed4HClose < previous4HLow) {
      tradnexDirection = "SELL";
      keyLevel = completed4HClose;
    }

    let tradnexConfirmation = false;

    const current15MClose = Number(completed15M.close);
    const previous15MClose = Number(previous15M.close);

    if (tradnexDirection === "BUY") {
      tradnexConfirmation =
        current15MClose > keyLevel &&
        previous15MClose <= keyLevel;
    }

    if (tradnexDirection === "SELL") {
      tradnexConfirmation =
        current15MClose < keyLevel &&
        previous15MClose >= keyLevel;
    }

    const marketData = {
      symbol,
      strategy: "TRADNEX 4H → 15M",
      completed4H,
      previous4H,
      completed15M,
      previous15M,
      tradnexDirection,
      keyLevel,
      tradnexConfirmation
    };

    const prompt = `
You are the TRADNEX Market Intelligence engine.

Analyze the supplied live market data.

CORE TRADNEX RULE:
A completed 4H candle closing above the previous 4H high creates a BUY setup.
A completed 4H candle closing below the previous 4H low creates a SELL setup.
The completed 4H closing price is the key level.
A completed 15M candle body must close above that level for BUY confirmation.
A completed 15M candle body must close below that level for SELL confirmation.

Never override this core strategy.

Return ONLY valid JSON with exactly these fields:

{
  "prediction": "BUY | SELL | NEUTRAL",
  "confidence": 0,
  "market_bias": "BULLISH | BEARISH | NEUTRAL",
  "momentum": "STRONG | MODERATE | WEAK | NEUTRAL",
  "volatility": "HIGH | MEDIUM | LOW",
  "market_insight": "",
  "setup_explanation": "",
  "key_factors": [],
  "risk_warning": "",
  "tradnex_confirmation": "CONFIRMED | PENDING | NONE"
}

Rules:
- confidence must be an integer from 0 to 100.
- If TRADNEX confirmation is false, do not claim that a confirmed TRADNEX trade exists.
- If the data does not establish a valid direction, prediction must be NEUTRAL.
- Do not invent news or market events.
- Do not invent prices.
- Do not provide fake certainty.
- The AI is market intelligence only and does not execute trades.

LIVE DATA:
${JSON.stringify(marketData)}
`;

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: "gpt-5.6-luna",
          input: prompt,
          store: false
        })
      }
    );

    const openaiData = await openaiResponse.json();

    if (!openaiResponse.ok) {
      return res.status(502).json({
        error: "OpenAI request failed",
        details: openaiData
      });
    }

    const outputText = openaiData.output_text || "";

    let analysis;

    try {
      analysis = JSON.parse(outputText);
    } catch {
      return res.status(502).json({
        error: "AI returned invalid JSON",
        raw: outputText
      });
    }

    return res.status(200).json({
      symbol,
      strategy: "TRADNEX 4H → 15M",
      market_data: marketData,
      ai: analysis,
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({
      error: "AI insights request failed",
      details: error.message
    });
  }
}
