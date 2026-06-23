import express, { type Request, Response, NextFunction } from "express";
import { spawn } from "child_process";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { assertAdminSchemaReady, SchemaNotReadyError } from "./schemaHealth";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const DEFAULT_PORT = 5001;
const DEV_PORT_FALLBACK_ATTEMPTS = 20;

function shouldOpenBrowser() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.NO_BROWSER !== "1" &&
    process.env.BROWSER !== "none"
  );
}

function getBrowserHost(host: string) {
  return host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
}

function parsePort(value: string | undefined, fallback: number) {
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return port;
}

function isAddressInUse(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "EADDRINUSE";
}

function listenOnce(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);

    try {
      server.listen(port, host);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function listenWithPortFallback(server: Server, startPort: number, host: string) {
  const maxAttempts =
    process.env.NODE_ENV === "development" ? DEV_PORT_FALLBACK_ATTEMPTS : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = startPort + attempt;
    if (port > 65535) {
      break;
    }

    try {
      await listenOnce(server, port, host);
      return port;
    } catch (error) {
      const canRetry = isAddressInUse(error) && attempt < maxAttempts - 1;
      if (!canRetry) {
        throw error;
      }
      log(`port ${port} is in use, trying ${port + 1}`);
    }
  }

  throw new Error(`No available port found starting from ${startPort}`);
}

function hasConfiguredAppOrigin() {
  return Boolean(
    process.env.ADMIN_APP_ORIGIN?.trim() ||
      process.env.APP_ORIGIN?.trim() ||
      process.env.PUBLIC_WEB_URL?.trim() ||
      process.env.BASE_URL?.trim(),
  );
}

function syncDevelopmentAppOrigin(host: string, port: number) {
  if (process.env.NODE_ENV !== "development" || hasConfiguredAppOrigin()) {
    return;
  }
  process.env.APP_ORIGIN = `http://${getBrowserHost(host)}:${port}`;
}

function openBrowser(url: string) {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["/c", "start", "", url]
      : [url];

  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  child.on("error", (error) => {
    log(`could not open browser automatically: ${error.message}`);
  });
  child.unref();
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    await assertAdminSchemaReady();
  } catch (error) {
    if (error instanceof SchemaNotReadyError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Use PORT from environment (Render assigns dynamically) or default to 5001 for development
  // In production, PORT is provided by Render and should not be hardcoded
  const port = parsePort(process.env.PORT, DEFAULT_PORT);
  
  if (process.env.NODE_ENV === 'production' && !process.env.PORT) {
    console.warn('Warning: PORT not set in production environment');
  }
  // Always bind to 0.0.0.0 in production for proper deployment
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : (process.env.HOST || "0.0.0.0");
  const actualPort = await listenWithPortFallback(server, port, host);
  syncDevelopmentAppOrigin(host, actualPort);
  log(`serving on port ${actualPort} and host ${host}`);
  if (shouldOpenBrowser()) {
    openBrowser(`http://${getBrowserHost(host)}:${actualPort}`);
  }
})();
