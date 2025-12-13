// Netlify Function: WT proxy (bypasses browser CORS by doing server-to-server fetch)
// Endpoint via redirect: /api/*  -> /.netlify/functions/wtProxy/:splat
// Example: GET /api/article?max=10&offset=0  ->  https://wt.kpi.fei.tuke.sk/api/article?max=10&offset=0

const WT_ORIGIN = "https://wt.kpi.fei.tuke.sk";
const WT_API_PREFIX = "/api";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Vary": "Origin",
  };
}

exports.handler = async (event) => {
  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    // event.path is usually like "/api/article" due to redirect, or "/.netlify/functions/wtProxy/article" without it
    const path = event.path || "";
    let upstreamPath = path;

    if (upstreamPath.startsWith("/api/")) {
      upstreamPath = upstreamPath.replace(/^\/api/, "");
    } else if (upstreamPath.startsWith("/.netlify/functions/wtProxy/")) {
      upstreamPath = upstreamPath.replace("/.netlify/functions/wtProxy", "");
    } else if (upstreamPath === "/.netlify/functions/wtProxy") {
      upstreamPath = "";
    }

    // Ensure we always target WT's /api prefix
    const qs = event.rawQuery || ""; // netlify provides rawQuery in newer runtimes
    const query = qs ? `?${qs}` : (event.queryStringParameters ? `?${new URLSearchParams(event.queryStringParameters).toString()}` : "");
    const url = `${WT_ORIGIN}${WT_API_PREFIX}${upstreamPath}${query}`;

    const headers = {};
    // Forward content-type for POST/PUT
    if (event.headers && event.headers["content-type"]) headers["content-type"] = event.headers["content-type"];
    if (event.headers && event.headers["Content-Type"]) headers["content-type"] = event.headers["Content-Type"];

    const resp = await fetch(url, {
      method: event.httpMethod,
      headers,
      body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body,
    });

    const contentType = resp.headers.get("content-type") || "application/json; charset=utf-8";
    const body = await resp.text();

    return {
      statusCode: resp.status,
      headers: {
        ...corsHeaders(),
        "Content-Type": contentType,
        // Avoid caching errors too aggressively
        "Cache-Control": resp.ok ? "public, max-age=60" : "no-store",
      },
      body,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "WT proxy failed", details: String(err) }),
    };
  }
};
