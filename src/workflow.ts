export type WorkflowResult = {
  input: string;
  output: string;
};

export async function runWorkflow(input: string): Promise<WorkflowResult> {
  if (!input) {
    throw new Error("Please enter some input before running the workflow.");
  }

  // Replace this function body with your own service, agent, or workflow.
  return {
    input,
    output: `Received: ${input}`,
  };
}