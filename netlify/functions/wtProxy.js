export async function handler(event) {
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

  // event.path e.g. "/.netlify/functions/wtProxy/article"
  const prefix = "/.netlify/functions/wtProxy";
  let rest = event.path.startsWith(prefix) ? event.path.slice(prefix.length) : "";
  if (!rest) rest = "/";
  if (!rest.startsWith("/")) rest = "/" + rest;

  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  const targetUrl = `${WT_BASE}${rest}${qs}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: event.httpMethod,
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body
    });

    const bodyText = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": upstream.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store"
      },
      body: bodyText
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({ error: "WT proxy failed", targetUrl, details: String(err) })
    };
  }
}