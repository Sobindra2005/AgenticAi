import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";

dotenv.config();

const key = process.env.api_key
export const llm = new ChatGroq({
    apiKey: key,
    model:'llama-3.3-70b-versatile',
    temperature:0.7
})