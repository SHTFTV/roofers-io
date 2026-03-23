import path from "path";
import { fileURLToPath } from "url";
import { build as esbuild } from "esbuild";
import { rm, readFile, access } from "fs/promises";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactsRoot = path.resolve(__dirname, "..");

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times without risking some
// packages that are not bundle compatible
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

const FRONTEND_APPS = [
  "estimators-io",
  "hvacr-tv",
  "hardscapes-io",
  "fabricators-io",
  "gasfitters-io",
  "plumbers-ltd",
  "sparkys-tv",
  "framers-io",
  "drywallers-io",
  "plowwow",
  "roofers-io",
];

async function buildFrontends() {
  for (const appName of FRONTEND_APPS) {
    const appDir = path.join(artifactsRoot, appName);
    const distCheck = path.join(appDir, "dist", "public", "index.html");
    try {
      await access(distCheck);
      console.log(`[skip] ${appName} already built`);
      continue;
    } catch {}
    console.log(`[build] ${appName}...`);
    try {
      execSync(`pnpm --filter @workspace/${appName} run build`, {
        cwd: path.resolve(artifactsRoot, ".."),
        stdio: "inherit",
        env: {
          ...process.env,
          BASE_PATH: `/${appName}/`,
          PORT: "5000",
        },
      });
    } catch (err) {
      console.error(`[warn] ${appName} build failed, skipping`);
    }
  }
}

async function buildAll() {
  console.log("=== Building frontend apps ===");
  await buildFrontends();

  const distDir = path.resolve(__dirname, "dist");
  await rm(distDir, { recursive: true, force: true });

  console.log("\n=== Building API server ===");
  const pkgPath = path.resolve(__dirname, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter(
    (dep) =>
      !allowlist.includes(dep) &&
      !(pkg.dependencies?.[dep]?.startsWith("workspace:")),
  );

  await esbuild({
    entryPoints: [path.resolve(__dirname, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: path.resolve(distDir, "index.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
