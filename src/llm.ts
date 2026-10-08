import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.api_key
export const llm = new ChatGroq({
    apiKey: key,
    model: 'llama-3.3-70b-versatile',
    temperature: 0.7
})


export const getLocalLLm = () => {
    return new ChatOllama({
        model: "deepseek-r1:1.5b",
        baseUrl: "http://localhost:11434", // Default Ollama local endpoint,
        temperature: 1,
    });

}