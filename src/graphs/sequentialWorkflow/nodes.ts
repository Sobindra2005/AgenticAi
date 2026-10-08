import { SystemMessage } from "langchain";
import { sequentialWorkflowStates } from "../../lib/types.js";

export const editor_node = (states: sequentialWorkflowStates) => {
    console.log(states)

    const prompt = new SystemMessage(`

        `)

    return prompt
}