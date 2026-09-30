import { getStore } from "@netlify/blobs";

const IDS = ["wizkid","davido","burna","rema","shally","benson",
  "poppy","tems","tiwa","ayra","yemi","simi"];

const clean = s => String(s || "")
  .replace(/[^\p{L}\p{N} _.\-]/gu, "")
  .replace(/\s+/g, " ").trim().slice(0, 14);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });

export default async (req) => {
  const store = getStore("keepy");
  let list = (await store.get("board", { type: "json" })) || [];

  if (req.method === "GET") {
    const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 500, 500);
    return json(list.sort((x, y) => y.s - x.s).slice(0, limit));
  }

  if (req.method === "POST") {
    let b;
    try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }

    const n = clean(b.n) || "Guest";
    const a = b.a;
    const s = Math.floor(Number(b.s));
    const d = Number(b.d) || 0;

    if (!IDS.includes(a)) return json({ error: "bad artist" }, 400);
    if (!Number.isFinite(s) || s < 1 || s >= 100000) return json({ error: "bad score" }, 400);
    if (s > Math.floor(d / 300) + 3) return json({ error: "implausible" }, 400);

    const found = list.find(e => e.a === a && e.n.toLowerCase() === n.toLowerCase());
    if (found) { if (s > found.s) found.s = s; }
    else list.push({ n, a, s });

    list.sort((x, y) => y.s - x.s);
    await store.setJSON("board", list.slice(0, 500));
    return json({ ok: true });
  }

  return json({ error: "method not allowed" }, 405);
};
