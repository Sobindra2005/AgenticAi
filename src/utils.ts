import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { TavilySearch } from "@langchain/tavily";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.api_key
export const llm = new ChatGroq({
    apiKey: key,
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7
})


export const getLocalLLm = (temperature = 0.6) => {
    return new ChatOllama({
        model: "deepseek-r1:1.5b",
        baseUrl: "http://localhost:11434", // Default Ollama local endpoint
        temperature,
    });
};

/**
 * Extracts <think>...</think> reasoning blocks from DeepSeek-R1 output
 * and separates them from the actual content.
 */
export function extractThinkAndContent(text: string): { thinking: string; content: string } {
    if (!text) return { thinking: "", content: "" };
    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
        const thinking = thinkMatch[1].trim();
        const content = text.replace(/<think>[\s\S]*?<\/think>/i, "").trim();
        return { thinking, content };
    }
    // If <think> tag is unclosed (still streaming or cut off)
    if (text.includes("<think>")) {
        const parts = text.split("<think>");
        return {
            thinking: parts[1]?.trim() ?? "",
            content: parts[0]?.trim() ?? ""
        };
    }
    return { thinking: "", content: text.trim() };
}


export const getTavily = () => {
    const tavily = new TavilySearch({
        maxResults: 5,
        tavilyApiKey: process.env.TAVILY_API_KEY
    })
    return tavily;
}
