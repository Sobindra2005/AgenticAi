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


export const getLocalLLm = () => {
    return new ChatOllama({
        model: "deepseek-r1:1.5b",
        baseUrl: "http://localhost:11434", // Default Ollama local endpoint,
        temperature: 1,
    });

}


export const getTavily = () => {
    const tavily = new TavilySearch({
        maxResults: 5,
        tavilyApiKey: process.env.TAVILY_API_KEY
    })
    return tavily;
}

// const interactWithTavily = async (input: string) => {
//     const result = await getTavily().invoke({ query: input })
//     console.log(result)
// }
// interactWithTavily("weather of pokhara").then((result) => console.log(result))