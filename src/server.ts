import "dotenv/config";
import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWorkflow, runWorkflowStream } from "./workflow.js";

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

app.get("/api/stream", async (request, response) => {
  const input = String(request.query.input ?? "").trim();
  if (!input) {
    return response.status(400).end();
  }

  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Connection', 'keep-alive');

  try {
    const stream = await runWorkflowStream(input);
    let fullOutput = "";

    for await (const chunk of stream) {
      const content = chunk.content.toString();
      fullOutput += content;
      response.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
    }

    response.write(`data: ${JSON.stringify({ done: true, fullOutput })}\n\n`);
    response.end();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    response.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
    response.end();
  }
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
