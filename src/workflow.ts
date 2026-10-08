import { ChatOllama } from "@langchain/ollama";

export type WorkflowResult = {
  input: string;
  output: string;
};

export async function runWorkflow(input: string): Promise<WorkflowResult> {
  if (!input) {
    throw new Error("Please enter some input before running the workflow.");
  }

  const llm = new ChatOllama({
    model: "qwen2.5:0.5b",
    baseUrl: "http://localhost:11434", // Default Ollama local endpoint
  });

  const response = await llm.invoke(input);

  return {
    input,
    output: response.content.toString(),
  };
}

export async function runWorkflowStream(input: string) {
  if (!input) {
    throw new Error("Please enter some input before running the workflow.");
  }

  const llm = new ChatOllama({
    model: "qwen2.5:0.5b",
    baseUrl: "http://localhost:11434", // Default Ollama local endpoint
  });

  return await llm.stream(input);
}