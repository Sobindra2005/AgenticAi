import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter, researchRoutes } from "./routes/index.js";
import { checkDatabaseConnection } from "./db/index.js";
import { renderAppPage } from "./views/ssr.js";
import * as esbuild from "esbuild";

const port = Number(process.env.PORT ?? 3000);
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const projectRoot = path.resolve(currentDirectory, "..");

const app = express();

// Body Parsing & Static Assets
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(projectRoot, "public")));

// Mount Routers (MVC Pattern)
app.use("/api", apiRouter);
app.use("/", researchRoutes);

// 404 Handler using React SSR
app.use((_request, response) => {
  const html = renderAppPage({
    title: "404 - Not Found",
    error: "That route does not exist.",
  });
  response
    .status(404)
    .setHeader("Content-Type", "text/html; charset=utf-8")
    .send(html);
});

// Verify Database Connection & Setup Bundler & Start Server
async function setupClientBundle(): Promise<void> {
  const isDev = process.env.NODE_ENV !== "production";
  try {
    const ctx = await esbuild.context({
      entryPoints: [path.join(projectRoot, "src/client/index.tsx")],
      bundle: true,
      minify: !isDev,
      sourcemap: isDev,
      format: "esm",
      outfile: path.join(projectRoot, "public/client.js"),
    });

    if (isDev) {
      await ctx.watch();
      console.log("[Bundler] ✓ Auto-building client on change (src/client/index.tsx -> public/client.js)");
    } else {
      await ctx.rebuild();
      await ctx.dispose();
      console.log("[Bundler] ✓ Client bundle built for production.");
    }
  } catch (error) {
    console.error("[Bundler] Error setting up client bundler:", error);
  }
}

checkDatabaseConnection()
  .then(() => setupClientBundle())
  .then(() => {
    app.listen(port, () => {
      console.log(`Agentic AI Playground running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("[Server] Cannot start server without PostgreSQL database connection:", err.message);
    process.exit(1);
  });
