export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // =========================================================
    // TRADNEX LIVE MULTI-MARKET SCANNER
    // =========================================================
    //
    // Uses the official TRADNEX signal engine.
    //
    // 4 markets per batch
    // 2 batches per minute
    // = maximum 8 Twelve Data credits/minute
    //
    // 30 markets = 8 batches
    // Full rotation = 4 minutes
    //
    // Strategy remains:
    // 4H → 15M
    //
    // =========================================================

    const baseUrl =
      process.env.TRADNEX_BASE_URL ||
      "https://tradnex.vercel.app";

    const batchSize = 4;
    const totalMarkets = 30;
    const totalBatches = Math.ceil(
      totalMarkets / batchSize
    );

    const batchesPerMinute = 2;

    // Current minute
    const minuteNumber =
      Math.floor(Date.now() / 60000);

    // Four-minute rotation:
    //
    // Minute 0 → batches 0,1
    // Minute 1 → batches 2,3
    // Minute 2 → batches 4,5
    // Minute 3 → batches 6,7
    // Then repeat.
    //
    const rotationLength =
      Math.ceil(
        totalBatches / batchesPerMinute
      );

    const rotation =
      minuteNumber % rotationLength;

    const firstBatch =
      rotation * batchesPerMinute;

    const batchNumbers = [];

    for (
      let i = 0;
      i < batchesPerMinute;
      i++
    ) {
      const batchNumber =
        firstBatch + i;

      if (batchNumber < totalBatches) {
        batchNumbers.push(batchNumber);
      }
    }

    const results = [];
    const batchReports = [];

    // =========================================================
    // RUN THE SELECTED BATCHES
    // =========================================================

    for (const batchNumber of batchNumbers) {
      try {
        const url =
          `${baseUrl}/api/signal-engine` +
          `?all=true` +
          `&batch=${batchNumber}`;

        const response =
          await fetch(url);

        let data;

        try {
          data = await response.json();
        } catch {
          data = {
            error:
              "Invalid response from signal engine"
          };
        }

        if (!response.ok) {
          batchReports.push({
            batch: batchNumber,
            status: "ERROR",
            httpStatus: response.status,
            details: data
          });

          continue;
        }

        const batchResults =
          Array.isArray(data.results)
            ? data.results
            : [];

        results.push(
          ...batchResults
        );

        batchReports.push({
          batch: batchNumber,
          status: "OK",
          scanned:
            data.scanned ??
            batchResults.length,
          signalsCreated:
            data.signalsCreated ??
            0,
          noSignal:
            data.noSignal ??
            0
        });

      } catch (error) {
        batchReports.push({
          batch: batchNumber,
          status: "ERROR",
          error: error.message
        });
      }
    }

    // =========================================================
    // REMOVE DUPLICATES
    // =========================================================

    const uniqueResults =
      Array.from(
        new Map(
          results.map(item => [
            item.symbol,
            item
          ])
        ).values()
      );

    // =========================================================
    // REAL SIGNALS ONLY
    // =========================================================

    const signals =
      uniqueResults.filter(
        item =>
          item &&
          item.signal
      );

    // =========================================================
    // CACHE
    // =========================================================

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=30"
    );

    // =========================================================
    // FINAL RESPONSE
    // =========================================================

    return res.status(200).json({

      scanner:
        "TRADNEX LIVE SCANNER",

      strategy:
        "TRADNEX 4H → 15M",

      status:
        signals.length > 0
          ? "SIGNALS_FOUND"
          : "NO_SIGNALS",

      rotation:
        `${rotation + 1}/${rotationLength}`,

      batches:
        batchNumbers,

      marketsScanned:
        uniqueResults.length,

      marketsPerBatch:
        batchSize,

      totalMarkets:
        totalMarkets,

      totalBatches:
        totalBatches,

      signalsFound:
        signals.length,

      signals,

      results:
        uniqueResults,

      batchReports,

      nextRotationInSeconds:
        60 -
        (
          Math.floor(
            Date.now() / 1000
          ) % 60
        ),

      scannedAt:
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
