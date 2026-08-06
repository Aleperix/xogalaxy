const COUNT_RE = /class="kSROCb">[^<]*\((\d+)\)/;

function frameUrl(blogId, origin, lang) {
  const params = new URLSearchParams({ pageSize: "21", hl: lang, origin });
  return `https://www.blogger.com/followers/frame/${blogId}?${params}`;
}

export async function getFollowers({ blogId, origin, lang, kv, cacheKey, cacheTtl }) {
  const cached = await kv.get(cacheKey);
  if (cached !== null) {
    try {
      const parsed = JSON.parse(cached);
      return { count: parsed.count, source: "blogger", cached: true, at: parsed.at };
    } catch (err) {
      console.error("followers cache parse error:", err);
    }
  }

  const res = await fetch(frameUrl(blogId, origin, lang), {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`followers frame HTTP ${res.status}`);
  }
  const html = await res.text();
  const match = html.match(COUNT_RE);
  if (!match) {
    throw new Error("followers count not found in frame");
  }

  const count = Number(match[1]);
  const at = new Date().toISOString();
  await kv.put(cacheKey, JSON.stringify({ count, at }), { expirationTtl: cacheTtl });
  return { count, source: "blogger", cached: false, at };
}
