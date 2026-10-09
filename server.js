import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { randomUUID } from "crypto";

const app = express();

app.use(cors());
app.use(express.json());

const sessions = new Map();
let browser;

app.get("/", (_, res) => {
  res.json({ ok: true, service: "Automação ativa" });
});

app.post("/sessions", async (req, res) => {
  let context;

  try {
    const url = String(req.body?.url || "");

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL inválida" });
    }

    if (!browser || !browser.isConnected()) {
      browser = await chromium.launch({
        args: ["--no-sandbox"]
      });
    }

    context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const id = randomUUID();

    sessions.set(id, {
      context,
      page,
      at: Date.now()
    });

    res.json({
      ok: true,
      sessionId: id,
      url: page.url()
    });
  } catch (e) {
    if (context) await context.close().catch(() => {});

    res.status(500).json({
      ok: false,
      error: String(e.message || e)
    });
  }
});

app.post("/sessions/:id/step", async (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({
      ok: false,
      error: "Sessão não encontrada"
    });
  }

  const { page } = session;
  session.at = Date.now();

  const waitSeconds = Math.min(
    Math.max(Number(req.body?.waitSeconds) || 5, 0),
    120
  );

  try {
    // Atualiza a página de teste autorizada.
    await page.reload({
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(waitSeconds * 1000);

    session.at = Date.now();

    res.json({
      ok: true,
      url: page.url(),
      message: "Etapa concluída",
      completed: true
    });
  } catch (e) {
    res.json({
      ok: false,
      url: page.url(),
      error: String(e.message || e)
    });
  }
});

app.post("/sessions/:id/stop", async (req, res) => {
  const session = sessions.get(req.params.id);

  if (session) {
    await session.context.close().catch(() => {});
    sessions.delete(req.params.id);
  }

  res.json({ ok: true });
});

setInterval(async () => {
  for (const [id, session] of sessions) {
    if (Date.now() - session.at > 10 * 60 * 1000) {
      await session.context.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, 60000);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Serviço de automação ativo na porta " + PORT);
});
