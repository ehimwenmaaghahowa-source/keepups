// Keepy Uppy — live ads & jumbo-screen messages.
//
//   GET  /.netlify/functions/ads           -> public config (what every player sees)
//   POST /.netlify/functions/ads           -> admin only (header: x-admin-key)
//        { action: "verify" }              -> { ok: true }
//        { action: "load" }                -> full config, including private notes
//        { action: "save", config: {...} } -> publishes; players see it within seconds
//
// Setup: in Netlify -> Site settings -> Environment variables add ADMIN_KEY
// (a long secret only you know). Needs the @netlify/blobs package.

import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_ITEMS = 24;
const COLORS = new Set(["gold", "white", "coral", "green", "cyan", "pink"]);

const HEAD = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, max-age=0",
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEAD });

const clean = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

const cleanDate = (s) => {
  const v = String(s ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : "";
};

function cleanItem(x, i, kind) {
  const text = clean(x && x.text, kind === "jumbo" ? 120 : 70);
  if (!text) return null;
  const item = {
    id: clean(x.id, 24) || `${kind[0]}${Date.now().toString(36)}${i}`,
    text,
    color: COLORS.has(x.color) ? x.color : "gold",
    until: cleanDate(x.until),
    who: clean(x.who, 60), // private note: who paid. Never sent to players.
  };
  if (kind === "jumbo") {
    const d = Math.round(Number(x.secs));
    item.secs = Number.isFinite(d) ? Math.min(30, Math.max(3, d)) : 7;
  }
  return item;
}

function sanitize(c, prevRev = 0) {
  const list = (a, kind) =>
    (Array.isArray(a) ? a : [])
      .slice(0, MAX_ITEMS)
      .map((x, i) => cleanItem(x, i, kind))
      .filter(Boolean);
  return {
    rev: prevRev + 1,
    updated: Date.now(),
    jumbo: list(c && c.jumbo, "jumbo"),
    boards: list(c && c.boards, "board"),
    contact: clean(c && c.contact, 80) || "ADVERTISE HERE",
  };
}

const EMPTY = { rev: 0, updated: 0, jumbo: [], boards: [], contact: "ADVERTISE HERE" };

const expired = (it) => it.until && Date.parse(it.until + "T23:59:59Z") + 14 * 3600e3 < Date.now();

function publicView(c) {
  const strip = ({ who, ...rest }) => rest;
  return {
    rev: c.rev,
    contact: c.contact,
    jumbo: c.jumbo.filter((x) => !expired(x)).map(strip),
    boards: c.boards.filter((x) => !expired(x)).map(strip),
  };
}

function keyOk(given) {
  const real = process.env.ADMIN_KEY || "";
  if (real.length < 8 || !given) return false; // refuse to run with a weak / missing key
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(real).digest();
  return timingSafeEqual(a, b);
}

export default async (req) => {
  const store = getStore("keepy-ads");
  let cfg = EMPTY;
  try {
    cfg = (await store.get("config", { type: "json" })) || EMPTY;
  } catch (e) {
    cfg = EMPTY;
  }

  if (req.method === "GET") return json(publicView(cfg));

  if (req.method !== "POST") return json({ error: "method" }, 405);

  if (!keyOk(req.headers.get("x-admin-key"))) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "bad json" }, 400);
  }

  if (body.action === "verify") return json({ ok: true });
  if (body.action === "load") return json(cfg);

  if (body.action === "save") {
    const next = sanitize(body.config, cfg.rev || 0);
    await store.setJSON("config", next);
    return json({ ok: true, rev: next.rev, config: next });
  }

  return json({ error: "action" }, 400);
};
