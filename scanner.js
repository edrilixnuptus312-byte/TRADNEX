export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // =========================================================
    // BUILD CURRENT TRADNEX API URL
    // =========================================================

    const protocol =
      req.headers["x-forwarded-proto"] || "https";

    const host =
      req.headers.host;

    const baseUrl =
      `${protocol}://${host}`;

    // =========================================================
    // TRADNEX SCANNER SETTINGS
    // =========================================================
    //
    // signal-engine already contains the official market list.
    //
    // 4 markets per batch
    // 2 batches per minute
    // = maximum 8 Twelve Data credits per minute
    //
    // 30 markets = 8 batches
    // 2 batches/minute = 4-minute full rotation
    //
    // Strategy remains:
    // 4H → 15M
    //
    // =========================================================

    const batchSize = 4;
    const batchesPerMinute = 2;
    const totalMarkets = 30;
    const totalBatches = Math.ceil(
      totalMarkets / batchSize
    );

    // =========================================================
    // ROTATE THROUGH ALL BATCHES
    // =========================================================
    //
    // Every minute moves to the next pair of batches.
    //
    // Minute 0 → batches 0 + 1
    // Minute 1 → batches 2 + 3
    // Minute 2 → batches 4 + 5
    // Minute 3 → batches 6 + 7
    // Then repeats.
    //
    // =========================================================

    const minuteNumber =
      Math.floor(Date.now() / 60000);

    const windowNumber =
      minuteNumber % Math.ceil(
        totalBatches / batchesPerMinute
      );

    const firstBatch =
      windowNumber * batchesPerMinute;

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

    // =========================================================
    // SCAN BATCHES SEQUENTIALLY
    // =========================================================
    //
    // Sequential requests prevent accidental bursts.
    //
    // Each batch contains only 4 markets.
    //
    // =========================================================

    const allResults = [];
    const batchReports = [];

    for (const batchNumber of batchNumbers) {
      try {
        const response = await fetch(
          `${baseUrl}/api/signal-engine?all=true&batch=${batchNumber}`
        );

        let data;

        try {
          data = await response.json();
        } catch {
          data = {
            error: "Invalid JSON response"
          };
        }

        if (!response.ok) {
          batchReports.push({
            batch: batchNumber,
            status: "ERROR",
            details: data
          });

          continue;
        }

        const results =
          Array.isArray(data.results)
            ? data.results
            : [];

        allResults.push(...results);

        batchReports.push({
          batch: batchNumber,
          status: "OK",
          scanned:
            data.scanned ?? results.length,
          signalsCreated:
            data.signalsCreated ?? 0,
          noSignal:
            data.noSignal ?? results.length
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
    // REMOVE ACCIDENTAL DUPLICATES
    // =========================================================

    const uniqueMarkets =
      Array.from(
        new Map(
          allResults.map(item => [
            item.symbol,
            item
          ])
        ).values()
      );

    // =========================================================
    // ONLY REAL SIGNALS
    // =========================================================
    //
    // No demo signals.
    // No generated signals.
    // No fake signals.
    //
    // =========================================================

    const liveSignals =
      uniqueMarkets.filter(
        item =>
          item &&
          (
            item.status === "SIGNAL_CREATED" ||
            item.signal
          ) &&
          item.signal
      );

    // =========================================================
    // RESPONSE
    // =========================================================

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=30"
    );

    return res.status(200).json({

      scanner:
        "TRADNEX LIVE SCANNER",

      strategy:
        "TRADNEX 4H → 15M",

      status:
        liveSignals.length > 0
          ? "SIGNALS_FOUND"
          : "NO_SIGNALS",

      rotation:
        `${windowNumber + 1}/4`,

      batches:
        batchNumbers,

      marketsScanned:
        uniqueMarkets.length,

      totalMarkets:
        totalMarkets,

      signalsFound:
        liveSignals.length,

      signals:
        liveSignals,

      markets:
        uniqueMarkets,

      batchReports:

        batchReports,

      nextRotationInSeconds:
        60 - (
          Math.floor(Date.now() / 1000) % 60
        ),

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
