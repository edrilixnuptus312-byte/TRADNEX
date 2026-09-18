export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // TradingView official webhook IP addresses
    const trustedTradingViewIPs = new Set([
      "52.89.214.238",
      "34.212.75.30",
      "54.218.53.128",
      "52.32.178.7"
    ]);

    // Get the original client IP through the Vercel proxy
    const forwardedFor = req.headers["x-forwarded-for"] || "";
    const clientIP = forwardedFor.split(",")[0].trim();

    // Keep secret-header authentication for manual testing
    const manualSecret = req.headers["x-tradnex-secret"];

    const validTradingViewIP = trustedTradingViewIPs.has(clientIP);
    const validManualSecret =
      manualSecret &&
      manualSecret === process.env.TRADNEX_WEBHOOK_SECRET;

    if (!validTradingViewIP && !validManualSecret) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    // TradingView sends JSON in the request body
    let body = req.body || {};

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          error: "Invalid JSON body"
        });
      }
    }

    const signal = {
      symbol: body.symbol || "XAUUSD",
      direction: body.direction,
      timeframe: body.timeframe || "15M",
      entry: body.entry ?? null,
      stop_loss: body.stop_loss ?? null,
      take_profit: body.take_profit ?? null,
      confidence: body.confidence ?? null,
      setup: body.setup ?? null,
      signal_reason: body.signal_reason ?? null,
      status: body.status || "ACTIVE"
    };

    if (!["BUY", "SELL"].includes(signal.direction)) {
      return res.status(400).json({
        error: "Direction must be BUY or SELL"
      });
    }

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/signals`,
      {
        method: "POST",
headers: {
  "Content-Type": "application/json",
  "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
  "Prefer": "return=representation"
},
        body: JSON.stringify(signal)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(data);

      return res.status(500).json({
        error: "Failed to save signal"
      });
    }

    return res.status(200).json({
      success: true,
      signal: data[0]
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Webhook error"
    });
  }
}
