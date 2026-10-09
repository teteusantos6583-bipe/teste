```js
import express from "express";
import cors from "cors";
import { chromium } from "playwright";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// Mostra o painel web
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Verifica se o servidor está funcionando
app.get("/status", (_, res) => {
  res.json({
    ok: true,
    service: "Automação ativa"
  });
});

const sessions = new Map();
let browser;

// Inicia uma sessão de teste em uma página autorizada
app.post("/sessions", async (req, res) => {
  let context;

  try {
    const url = String(req.body?.url || "").trim();

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({
        ok: false,
        error: "URL inválida. Use um endereço começando com https://"
      });
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
      url: page.url(),
      message: "Teste iniciado"
    });
  } catch (e) {
    if (context) {
      await context.close().catch(() => {});
    }

    res.status(500).json({
      ok: false,
      error: String(e.message || e)
    });
  }
});

// Executa uma etapa manual de teste
app.post("/sessions/:id/step", async (req, res) => {
  const session = sessions.get(req.params.id);

  if (!session) {
    return res.status(404).json({
      ok: false,
      error: "Sessão não encontrada ou já encerrada"
    });
  }

  const { page } = session;

  const requestedWait = Number(req.body?.waitSeconds ?? 5);
  const waitSeconds = Math.min(
    Math.max(Number.isFinite(requestedWait) ? requestedWait : 5, 0),
    120
  );

  try {
    await page.reload({
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(waitSeconds * 1000);

    session.at = Date.now();

    res.json({
      ok: true,
      url: page.url(),
      message: "Etapa de teste concluída",
      completed: true
    });
  } catch (e) {
    res.status(500).json({
      ok: false,
      url: page.url(),
      error: String(e.message || e)
    });
  }
});

// Encerra uma sessão
app.post("/sessions/:id/stop", async (req, res) => {
  const session = sessions.get(req.params.id);

  if (session) {
    await session.context.close().catch(() => {});
    sessions.delete(req.params.id);
  }

  res.json({
    ok: true,
    message: "Sessão encerrada"
  });
});

// Limpa sessões inativas após 10 minutos
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
```
