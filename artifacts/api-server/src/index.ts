import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./lib/db";
import { startTelegramBot } from "./lib/telegram-bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runMigrations().then(() => {
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  const isProduction = process.env["NODE_ENV"] === "production";

  if (isProduction) {
    // In production, use Telegram webhooks — no polling, no 409 conflict
    // REPLIT_DOMAINS contains the deployed domain e.g. "myapp.replit.app"
    const domains = process.env["REPLIT_DOMAINS"] ?? "";
    const primaryDomain = domains.split(",")[0]?.trim();

    if (primaryDomain) {
      const webhookUrl = `https://${primaryDomain}/api/telegram-webhook`;
      const bot = startTelegramBot(webhookUrl);

      if (bot) {
        // Register the webhook endpoint so Express can receive Telegram updates
        app.post("/api/telegram-webhook", (req, res) => {
          bot.processUpdate(req.body as Parameters<typeof bot.processUpdate>[0]);
          res.sendStatus(200);
        });
        logger.info({ webhookUrl }, "Telegram webhook endpoint registered");
      }
    } else {
      logger.warn("REPLIT_DOMAINS not set — falling back to polling in production");
      startTelegramBot();
    }
  } else {
    // In development, use polling (deletes any stale webhook first)
    startTelegramBot();
  }
});
});
