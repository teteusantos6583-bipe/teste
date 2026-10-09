import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { randomUUID } from "crypto";

const app = express();
app.use(cors());
app.use(express.json());
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const sessions = new Map();
const ADULT = ["adult", "18+", "porn", "xxx", "nsfw", "sexo", "adulto", "nude"];
const AD_SEL = "iframe, [id*=ad i], [class*=ad- i], [class*=ads i], [class*=sponsor i], [class*=banner i]";

app.get("/", (_, res) => res.json({ ok: true }));

app.post("/sessions", async (req, res) => {
  try {
    const url = String(req.body?.url || "");
    if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: "URL inválida" });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const id = randomUUID();
    sessions.set(id, { context, page, at: Date.now() });
    res.json({ sessionId: id });
  } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
});

app.post("/sessions/:id/step", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Sessão não encontrada" });
  const { page } = s; s.at = Date.now();
  const wait = Math.min(Math.max(Number(req.body?.waitSeconds) || 5, 0), 120);
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : ["Avançar", "Continuar"];
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(wait * 1000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
    const text = ((await page.textContent("body")) || "").toLowerCase();
    const adultSignals = ADULT.filter((w) => text.includes(w));
    let buttonFound = null;
    for (const label of labels) {
      const cands = page.locator(`button, a, [role=button], input[type=submit]`).filter({ hasText: label });
      const n = await cands.count();
      for (let i = 0; i < n; i++) {
        const el = cands.nth(i);
        const inAd = await el.evaluate((node, sel) => !!node.closest(sel), AD_SEL);
        if (inAd || !(await el.isVisible())) continue;
        await el.click({ timeout: 5000 });
        await page.waitForLoadState("domcontentloaded").catch(() => {});
        buttonFound = label; break;
      }
      if (buttonFound) break;
    }
    res.json({ ok: true, url: page.url(), buttonFound, adultSignals });
  } catch (e) { res.json({ ok: false, url: page.url(), error: String(e.message || e) }); }
});

app.post("/sessions/:id/stop", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) { await s.context.close().catch(() => {}); sessions.delete(req.params.id); }
  res.json({ ok: true });
});

setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.at > 10 * 60000) { s.context.close().catch(() => {}); sessions.delete(id); }
}, 60000);

app.listen(process.env.PORT || 3000, () => console.log("Serviço de automação ativo"));
