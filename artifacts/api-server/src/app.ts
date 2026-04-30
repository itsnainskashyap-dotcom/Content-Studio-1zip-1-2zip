import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import path from "node:path";
import { existsSync } from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachUser } from "./middleware/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
// Body limit kept at 10mb for the legacy `regenerate-character-image`
// endpoint, which still accepts a raw base64-inlined reference photo
// uploaded by the user from a file picker. Generated images now flow
// through Object Storage and stay tiny on the wire.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(attachUser);

app.use("/api", router);

// In production, this single Express process is the only thing Autoscale
// runs, so it must also serve the React frontend. The Vite-built static
// files live in artifacts/contentstudio-ai/dist/public — built either by
// the .replit pre-build hook or by the contentstudio-ai workflow in dev.
// In dev we deliberately skip this so Vite's dev server (on its own port)
// stays the source of truth for the frontend.
if (process.env["NODE_ENV"] === "production") {
  const frontendDist = path.resolve(
    process.cwd(),
    "artifacts/contentstudio-ai/dist/public",
  );

  if (existsSync(frontendDist)) {
    logger.info({ frontendDist }, "Serving frontend static files");

    // Long-cache hashed assets, no-cache for everything else (so index.html
    // and the unversioned icons always pick up new builds immediately).
    app.use(
      express.static(frontendDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );

    // SPA fallback: any non-/api GET that didn't match a static file gets
    // index.html so React Router can handle the route on the client.
    app.get(/^\/(?!api(\/|$)).*/, (_req: Request, res: Response) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  } else {
    logger.warn(
      { frontendDist },
      "Frontend dist directory not found; only /api routes will respond",
    );
  }
}

export default app;
