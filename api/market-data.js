export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "TWELVE_DATA_API_KEY is not configured"
    });
  }

  try {
    const symbol = req.query.symbol || "XAU/USD";

    const [h4Response, m15Response] = await Promise.all([
      fetch(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=4h&outputsize=10&order=desc&apikey=${encodeURIComponent(apiKey)}`
      ),
      fetch(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=15min&outputsize=20&order=desc&apikey=${encodeURIComponent(apiKey)}`
      )
    ]);

    const h4 = await h4Response.json();
    const m15 = await m15Response.json();

    if (h4.status === "error") {
      return res.status(502).json({
        error: "Twelve Data 4H request failed",
        details: h4
      });
    }

    if (m15.status === "error") {
      return res.status(502).json({
        error: "Twelve Data 15M request failed",
        details: m15
      });
    }

    return res.status(200).json({
      symbol,
      source: "Twelve Data",
      intervals: {
        h4: h4.values || [],
        m15: m15.values || []
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: "Market data request failed",
      details: error.message
    });
  }
}
