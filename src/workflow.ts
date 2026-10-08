import { getLocalLLm } from "./llm.js";

export type WorkflowResult = {
  input: string;
  output: string;
};

export async function runWorkflow(input: string): Promise<WorkflowResult> {
  if (!input) {
    throw new Error("Please enter some input before running the workflow.");
  }

  const llm = getLocalLLm()

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

  const llm = getLocalLLm()

  return await llm.stream(input);
}