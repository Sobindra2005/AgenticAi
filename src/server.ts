import "dotenv/config";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiRouter, researchRoutes } from "./routes/index.js";
import { checkDatabaseConnection } from "./db/index.js";

const port = Number(process.env.PORT ?? 3000);
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const projectRoot = path.resolve(currentDirectory, "..");

const app = express();

// View Engine & Layouts
app.set("view engine", "ejs");
app.set("views", path.join(projectRoot, "views"));
app.set("layout", "layout");
app.use(expressLayouts);

// Body Parsing & Static Assets
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(projectRoot, "public")));

// Mount Routers (MVC Pattern)
app.use("/api", apiRouter);
app.use("/", researchRoutes);

// 404 Handler
app.use((_request, response) => {
  response.status(404).render("index", {
    title: "Not Found",
    input: "",
    result: null,
    error: "That route does not exist.",
  });
});

// Verify Database Connection & Start Server
checkDatabaseConnection()
  .then(() => {
    app.listen(port, () => {
      console.log(`Agentic AI Playground running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("[Server] Cannot start server without PostgreSQL database connection:", err.message);
    process.exit(1);
  });
