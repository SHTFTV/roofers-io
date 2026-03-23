import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const FRONTEND_APPS = [
  "estimators-io",
  "gasfitters-io",
  "plumbers-ltd",
  "sparkys-tv",
  "hvacr-tv",
  "hardscapes-io",
  "fabricators-io",
  "framers-io",
  "drywallers-io",
  "plowwow",
  "roofers-io",
];

const workspaceRoot = process.env.REPL_HOME || "/home/runner/workspace";
const artifactsRoot = path.resolve(workspaceRoot, "artifacts");

for (const appName of FRONTEND_APPS) {
  const staticDir = path.join(artifactsRoot, appName, "dist", "public");
  if (existsSync(staticDir)) {
    const cacheOpts = process.env.NODE_ENV === "production" ? { maxAge: "1d" } : {};
    app.use(`/${appName}`, express.static(staticDir, cacheOpts));
    app.get(`/${appName}/{*splat}`, (_req, res) => {
      res.sendFile(path.join(staticDir, "index.html"));
    });
  }
}

app.get("/", (_req, res) => {
  res.redirect("/estimators-io/");
});

export default app;
