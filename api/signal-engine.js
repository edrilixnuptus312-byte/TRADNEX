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

  /*
   * =========================================================
   * TRADNEX LIVE MARKET UNIVERSE
   * =========================================================
   */

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

  /*
   * =========================================================
   * SINGLE SYMBOL MODE
   *
   * /api/signal-engine?symbol=XAU/USD
   *
   * ALL SYMBOL MODE
   *
   * /api/signal-engine?all=true
   * =========================================================
   */

 const requestedSymbol = req.query.symbol;

const scanAll =
  String(req.query.all || "").toLowerCase() === "true";

const batchNumber = Math.max(
  0,
  Number.parseInt(req.query.batch || "0", 10) || 0
);

const batchSize = 4;

let requestedSymbols;

if (scanAll) {

  const startIndex =
    batchNumber * batchSize;

  requestedSymbols =
    symbols.slice(
      startIndex,
      startIndex + batchSize
    );

} else if (requestedSymbol) {

  requestedSymbols = [requestedSymbol];

} else {

  requestedSymbols = ["XAU/USD"];

}

/*
 * Only allow instruments in the official
 * TRADNEX market universe.
 */

const invalidSymbols =
  requestedSymbols.filter(
    symbol => !symbols.includes(symbol)
  );

if (invalidSymbols.length > 0) {

  return res.status(400).json({

    error:
      "Unsupported TRADNEX symbol",

    symbols:
      invalidSymbols,

    supportedSymbols:
      symbols

  });

}

/*
 * Prevent an invalid batch from returning
 * an empty successful scan.
 */

if (scanAll && requestedSymbols.length === 0) {

  return res.status(400).json({

    error:
      "TRADNEX batch is out of range",

    batch:
      batchNumber,

    batchSize,

    totalMarkets:
      symbols.length,

    totalBatches:
      Math.ceil(symbols.length / batchSize)

  });

}


  try {
    /*
     * =======================================================
     * GET COMPLETED 4H DATA
     * =======================================================
     *
     * Twelve Data supports multiple symbols in one request.
     */

/*
 * =========================================================
 * GET 15M DATA ONCE
 *
 * TRADNEX uses 15M data as the source for both:
 * - 15M confirmation
 * - internally-built 4H candles
 *
 * This reduces Twelve Data usage from:
 * 4H + 15M
 * to:
 * 15M only
 * =========================================================
 */

const symbolQuery = requestedSymbols.join(",");

const m15Response = await fetch(
  `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbolQuery
  )}&interval=15min&outputsize=80&order=desc&timezone=UTC&apikey=${encodeURIComponent(
    twelveKey
  )}`
);

const m15Data = await m15Response.json();

/*
 * =========================================================
 * HANDLE TWELVE DATA ERROR
 * =========================================================
 */

if (m15Data.status === "error") {

  return res.status(502).json({

    error:
      "Twelve Data 15M request failed",

    details:
      m15Data

  });

}

/*
 * =========================================================
 * BUILD TRADNEX 4H CANDLES FROM 15M DATA
 *
 * Uganda TRADNEX 4H boundaries:
 *
 * 01:00–05:00
 * 05:00–09:00
 * 09:00–13:00
 * 13:00–17:00
 * 17:00–21:00
 * 21:00–01:00
 *
 * In UTC these begin at:
 *
 * 22:00
 * 02:00
 * 06:00
 * 10:00
 * 14:00
 * 18:00
 *
 * Twelve Data is requested in UTC.
 * =========================================================
 */

function build4HFrom15M(series) {

  if (!Array.isArray(series)) {
    return [];
  }

  const groups = new Map();

  const FOUR_HOURS =
    4 * 60 * 60 * 1000;

  /*
   * Anchor the 4H structure at 18:00 UTC.
   * This produces:
   *
   * 18:00
   * 22:00
   * 02:00
   * 06:00
   * 10:00
   * 14:00
   */

  const anchor =
    Date.UTC(
      1970,
      0,
      1,
      18,
      0,
      0
    );

  for (const candle of series) {

    if (!candle || !candle.datetime) {
      continue;
    }

    const timestamp =
      Date.parse(
        `${String(candle.datetime).replace(" ", "T")}Z`
      );

    if (!Number.isFinite(timestamp)) {
      continue;
    }

    const bucket =
      Math.floor(
        (timestamp - anchor) /
          FOUR_HOURS
      ) * FOUR_HOURS + anchor;

    if (!groups.has(bucket)) {
      groups.set(bucket, []);
    }

    groups
      .get(bucket)
      .push(candle);
  }

  const candles = [];

  for (const [
    bucket,
    group
  ] of groups.entries()) {

    /*
     * A complete 4H candle must contain
     * sixteen 15M candles.
     */

    if (group.length < 16) {
      continue;
    }

    group.sort(
      (a, b) =>
        Date.parse(
          `${String(a.datetime).replace(" ", "T")}Z`
        ) -
        Date.parse(
          `${String(b.datetime).replace(" ", "T")}Z`
        )
    );

    const first =
      group[0];

    const last =
      group[group.length - 1];

    const high =
      Math.max(
        ...group.map(
          candle =>
            Number(candle.high)
        )
      );

    const low =
      Math.min(
        ...group.map(
          candle =>
            Number(candle.low)
        )
      );

    const open =
      Number(first.open);

    const close =
      Number(last.close);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close)
    ) {
      continue;
    }

    const datetime =
      new Date(bucket)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");

    candles.push({

      datetime,

      open:
        String(open),

      high:
        String(high),

      low:
        String(low),

      close:
        String(close)

    });
  }

  /*
   * Twelve Data returns newest first.
   * Keep the same order because the existing
   * TRADNEX engine expects:
   *
   * h4[0] = current
   * h4[1] = completed
   * h4[2] = previous
   */

  candles.sort(
    (a, b) =>
      Date.parse(
        `${String(b.datetime).replace(" ", "T")}Z`
      ) -
      Date.parse(
        `${String(a.datetime).replace(" ", "T")}Z`
      )
  );

  return candles;
}

/*
 * Create an h4Data object compatible with
 * the existing getSeries() function.
 */

const h4Data = {};

for (const symbol of requestedSymbols) {

  const series =
    getSeries(
      m15Data,
      symbol
    );

  h4Data[symbol] = {

    values:
      build4HFrom15M(series)

  };

}

    /*
     * =======================================================
     * NORMALIZE BATCH RESPONSE
     *
     * Single-symbol requests can return:
     *
     * {
     *   values: [...]
     * }
     *
     * Batch requests return data keyed by symbol.
     * =======================================================
     */

    function getSeries(data, symbol) {
      if (!data) return [];

      /*
       * Single-symbol response
       */
      if (Array.isArray(data.values)) {
        return data.values;
      }

      /*
       * Batch response
       */
      const result = data[symbol];

      if (!result) {
        return [];
      }

      if (Array.isArray(result.values)) {
        return result.values;
      }

      return [];
    }

    /*
     * =======================================================
     * PROCESS ONE SYMBOL
     * =======================================================
     */

    async function processSymbol(symbol) {
      const h4 = getSeries(h4Data, symbol);
      const m15 = getSeries(m15Data, symbol);

      if (h4.length < 3 || m15.length < 3) {
        return {
          symbol,
          status: "INSUFFICIENT_DATA",
          signal: null
        };
      }

      /*
       * Twelve Data newest candle first.
       *
       * h4[0] = current 4H candle
       * h4[1] = completed 4H candle
       * h4[2] = previous 4H candle
       *
       * m15[0] = current 15M candle
       * m15[1] = completed 15M candle
       * m15[2] = previous 15M candle
       */

      const current4H = h4[0];
      const completed4H = h4[1];
      const previous4H = h4[2];

      const completed15M = m15[1];
      const previous15M = m15[2];

      /*
       * =====================================================
       * NUMERIC VALUES
       * =====================================================
       */

      const completed4HClose =
        Number(completed4H.close);

      const previous4HHigh =
        Number(previous4H.high);

      const previous4HLow =
        Number(previous4H.low);

      const completed15MClose =
        Number(completed15M.close);

      const previous15MClose =
        Number(previous15M.close);

      const completed15MOpen =
        Number(completed15M.open);

      if (
        !Number.isFinite(completed4HClose) ||
        !Number.isFinite(previous4HHigh) ||
        !Number.isFinite(previous4HLow) ||
        !Number.isFinite(completed15MClose) ||
        !Number.isFinite(previous15MClose)
      ) {
        return {
          symbol,
          status: "INVALID_MARKET_DATA",
          signal: null
        };
      }

      /*
       * =====================================================
       * TRADNEX 4H SETUP
       * =====================================================
       *
       * BUY:
       * completed 4H CLOSE > previous 4H HIGH
       *
       * SELL:
       * completed 4H CLOSE < previous 4H LOW
       *
       * The completed 4H CLOSE becomes the key level.
       */

      let direction = null;
      let keyLevel = null;

      if (completed4HClose > previous4HHigh) {
        direction = "BUY";
        keyLevel = completed4HClose;
      }

      if (completed4HClose < previous4HLow) {
        direction = "SELL";
        keyLevel = completed4HClose;
      }

      /*
       * =====================================================
       * 15M CONFIRMATION
       * =====================================================
       *
       * BUY:
       * completed 15M body closes ABOVE key level
       *
       * SELL:
       * completed 15M body closes BELOW key level
       *
       * Previous 15M close must still be on the opposite side.
       */

      let confirmation = false;

      if (direction === "BUY") {
        confirmation =
          completed15MClose > keyLevel &&
          previous15MClose <= keyLevel;
      }

      if (direction === "SELL") {
        confirmation =
          completed15MClose < keyLevel &&
          previous15MClose >= keyLevel;
      }

      /*
       * =====================================================
       * NO SIGNAL
       * =====================================================
       */

      if (!direction || !confirmation) {
        return {
          symbol,
          status: "NO_SIGNAL",
          signal: null,
          setup: {
            direction,
            keyLevel,
            completed4HTime:
              completed4H.datetime,
            completed15MTime:
              completed15M.datetime
          }
        };
      }

      /*
       * =====================================================
       * REAL SIGNAL TIME
       * =====================================================
       */

      const signalTime =
        completed15M.datetime;

      /*
       * =====================================================
       * DUPLICATE PROTECTION
       * =====================================================
       *
       * Search recent signals for this exact
       * confirmation candle.
       */

      const recentResponse = await fetch(
        `${supabaseUrl}/rest/v1/signals` +
        `?symbol=eq.${encodeURIComponent(symbol)}` +
        `&timeframe=eq.15M` +
        `&select=id,message,created_at` +
        `&order=created_at.desc` +
        `&limit=20`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization:
              `Bearer ${supabaseKey}`
          }
        }
      );

      const recentSignals =
        await recentResponse.json();

      if (!recentResponse.ok) {
        throw new Error(
          `Supabase lookup failed for ${symbol}`
        );
      }

      const duplicate =
        Array.isArray(recentSignals) &&
        recentSignals.some(signal =>
          String(signal.message || "")
            .includes(signalTime)
        );

      if (duplicate) {
        return {
          symbol,
          status: "ALREADY_RECORDED",
          signal: null,
          signalTime
        };
      }

      /*
       * =====================================================
       * OBJECTIVE SETUP CONFIDENCE
       * =====================================================
       *
       * This is setup-strength confidence.
       * It is NOT a guaranteed win probability.
       */

      const breakoutDistance =
        Math.abs(
          completed4HClose -
          (
            direction === "BUY"
              ? previous4HHigh
              : previous4HLow
          )
        );

      const previous4HRange =
        previous4HHigh -
        previous4HLow;

      const confirmationDistance =
        Math.abs(
          completed15MClose -
          keyLevel
        );

      const confirmationBody =
        Math.abs(
          completed15MClose -
          completed15MOpen
        );

      let confidence = 70;

      if (previous4HRange > 0) {
        const breakoutStrength =
          breakoutDistance /
          previous4HRange;

        if (breakoutStrength >= 0.50) {
          confidence += 10;
        } else if (breakoutStrength >= 0.25) {
          confidence += 5;
        }
      }

      if (confirmationBody > 0) {
        const confirmationStrength =
          confirmationDistance /
          confirmationBody;

        if (confirmationStrength >= 1) {
          confidence += 10;
        } else if (confirmationStrength >= 0.50) {
          confidence += 5;
        }
      }

      confidence =
        Math.min(
          95,
          Math.max(70, confidence)
        );

      /*
       * =====================================================
       * REAL TRADNEX SIGNAL
       * =====================================================
       *
       * SL / TP intentionally remain null.
       * User sets them manually.
       */

      const signal = {
        symbol,

        direction,

        timeframe: "15M",

        entry:
          completed15MClose,

        stop_loss: null,

        take_profit: null,

        status: "ACTIVE",

        message:
          `TRADNEX ${direction} confirmation | ${signalTime}`,

        confidence,

        setup:
          "4H → 15M",

        signal_reason:
          direction === "BUY"
            ? "Completed 4H candle closed above the previous 4H high. Its closing price became the key level, then the completed 15M candle body closed above that level."
            : "Completed 4H candle closed below the previous 4H low. Its closing price became the key level, then the completed 15M candle body closed below that level."
      };

      /*
       * =====================================================
       * SAVE REAL SIGNAL
       * =====================================================
       */

      const insertResponse =
        await fetch(
          `${supabaseUrl}/rest/v1/signals`,
          {
            method: "POST",

            headers: {
              apikey: supabaseKey,
              Authorization:
                `Bearer ${supabaseKey}`,
              "Content-Type":
                "application/json",
              Prefer:
                "return=representation"
            },

            body:
              JSON.stringify(signal)
          }
        );

      const inserted =
        await insertResponse.json();

      if (!insertResponse.ok) {
        return {
          symbol,
          status: "SAVE_FAILED",
          signal: null,
          details: inserted
        };
      }

      return {
        symbol,

        status:
          "SIGNAL_CREATED",

        signal:
          inserted[0] || signal,

        signalTime,

        confidence
      };
    }

    /*
     * =======================================================
     * RUN ALL SUPPORTED SYMBOLS
     * =======================================================
     */

    const results = [];

    for (const symbol of requestedSymbols) {
      try {
        const result =
          await processSymbol(symbol);

        results.push(result);
      } catch (error) {
        results.push({
          symbol,
          status: "ERROR",
          signal: null,
          error: error.message
        });
      }
    }

    /*
     * =======================================================
     * SUMMARY
     * =======================================================
     */

    const created =
      results.filter(
        result =>
          result.status ===
          "SIGNAL_CREATED"
      );

    const noSignal =
      results.filter(
        result =>
          result.status ===
          "NO_SIGNAL"
      );

    return res.status(200).json({
      strategy:
        "TRADNEX 4H → 15M",

      scanned:
        requestedSymbols.length,

      signalsCreated:
        created.length,

      noSignal:
        noSignal.length,

      results
    });

  } catch (error) {
    return res.status(500).json({
      error:
        "TRADNEX signal engine failed",

      details:
        error.message
    });
  }
}

 
