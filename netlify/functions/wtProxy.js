/**
 * Netlify Function: wtProxy
 * Proxies requests to WT API to bypass browser CORS.
 *
 * Frontend calls: /api/<path>?query
 * Netlify redirects to: /.netlify/functions/wtProxy/<path>?query
 */
export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      },
      body: ""
    };
  }

  const WT_BASE = "https://wt.kpi.fei.tuke.sk/api";

  // event.path looks like "/.netlify/functions/wtProxy/article" or "/.netlify/functions/wtProxy"
  const marker = "/.netlify/functions/wtProxy";
  let rest = event.path.includes(marker) ? event.path.split(marker)[1] : "";
  if (!rest) rest = "/";
  if (!rest.startsWith("/")) rest = "/" + rest;

  const qs = event.rawQueryString ? ("?" + event.rawQueryString) : "";
  const targetUrl = WT_BASE + rest + qs;

  try {
    const upstream = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: {
        // Forward only safe headers
        "Content-Type": event.headers?.["content-type"] || "application/json",
        "Accept": "application/json"
      },
      body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body
    });

    const bodyText = await upstream.text();
    const contentType = upstream.headers.get("content-type") || "application/json";

    return {
      statusCode: upstream.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      },
      body: bodyText
    };
  } catch (err) {
    // Return a JSON error the frontend can handle
    return {
      statusCode: 502,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        error: "WT proxy failed",
        targetUrl,
        details: String(err)
      })
    };
  }
}
