import { ChatOllama } from "@langchain/ollama";
import { getLLm } from "./llm.js";

export type WorkflowResult = {
  input: string;
  output: string;
};

export async function runWorkflow(input: string): Promise<WorkflowResult> {
  if (!input) {
    throw new Error("Please enter some input before running the workflow.");
  }

  const llm = getLLm()

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

  const llm = getLLm()

  return await llm.stream(input);
}