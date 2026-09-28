import "dotenv/config";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflow } from "./workflow.js";

const port = Number(process.env.PORT ?? 3000);
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const projectRoot = path.resolve(currentDirectory, "..");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(projectRoot, "views"));
app.set("layout", "layout");
app.use(expressLayouts);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(projectRoot, "public")));

app.get("/", (_request, response) => {
  response.render("index", {
    title: "Agentic AI Playground",
    input: "",
    result: null,
    error: null,
  });
});

app.post("/run", async (request, response) => {
  const input = String(request.body.input ?? "").trim();

  try {
    const result = await runWorkflow(input);

    response.render("index", { title: "Agentic AI Playground", input, result, error: null });
  } catch (error) {
    response.status(500).render("index", {
      title: "Agentic AI Playground",
      input,
      result: null,
      error: error instanceof Error ? error.message : "Your custom workflow failed.",
    });
  }
});

app.get("/api/run", async (request, response) => {
  response.json(await runWorkflow(String(request.query.input ?? "")));
});

app.use((_request, response) => {
  response.status(404).render("index", {
    title: "Not Found",
    input: "",
    result: null,
    error: "That route does not exist.",
  });
});

app.listen(port, () => {
  console.log(`Agentic AI Playground running at http://localhost:${port}`);
  console.log("Use the browser UI or /api/chain?message=your-name and /api/graph?message=start");
});
