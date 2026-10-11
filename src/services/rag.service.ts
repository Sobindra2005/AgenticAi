import { OllamaEmbeddings } from "@langchain/ollama";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { pgClient } from "../db/index.js";
import { SourceItem } from "../graphs/state.js";

/**
 * Initializes OllamaEmbeddings with local nomic-embed-text (768 dimensions).
 */
export const getEmbeddings = () => {
  return new OllamaEmbeddings({
    model: "nomic-embed-text",
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
  });
};

export interface RetrievedChunk {
  id: string;
  sourceUrl: string;
  sourceTitle: string;
  content: string;
  similarity: number;
}

export const defaultTextSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,
  chunkOverlap: 80,
  separators: ["\n\n", "\n", ". ", " ", ""],
});

/**
 * Splits text into coherent semantic paragraphs / chunks with overlap
 * using LangChain's RecursiveCharacterTextSplitter.
 */
export async function chunkText(
  text: string,
  chunkSize = 500,
  chunkOverlap = 80
): Promise<string[]> {
  if (!text || text.trim().length === 0) return [];

  const splitter =
    chunkSize === 500 && chunkOverlap === 80
      ? defaultTextSplitter
      : new RecursiveCharacterTextSplitter({
          chunkSize,
          chunkOverlap,
          separators: ["\n\n", "\n", ". ", " ", ""],
        });

  const rawChunks = await splitter.splitText(text);
  return rawChunks.map((c) => c.trim()).filter((c) => c.length > 20);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(str?: string | null): boolean {
  return Boolean(str && UUID_REGEX.test(str));
}

/**
 * Synchronizes and vectorizes ONLY sources that belong to the Knowledge Base for a thread.
 * Chunks the complete, full content of each Knowledge Base source using RecursiveCharacterTextSplitter.
 * Prunes any chunks that belong to URLs no longer in the Knowledge Base.
 */
export async function syncKnowledgeBaseVectors(
  threadId: string,
  kbSources: SourceItem[],
  activeKbUrls?: Set<string>
): Promise<number> {
  if (!isValidUuid(threadId)) return 0;

  // 1. If activeKbUrls is supplied, prune chunks for sources removed from the Knowledge Base
  if (activeKbUrls) {
    const urls = Array.from(activeKbUrls);
    if (urls.length === 0) {
      await pgClient`DELETE FROM knowledge_chunks WHERE thread_id = ${threadId}`;
      return 0;
    } else {
      await pgClient`
        DELETE FROM knowledge_chunks 
        WHERE thread_id = ${threadId} 
          AND NOT (source_url = ANY(${urls}))
      `;
    }
  }

  if (!kbSources || kbSources.length === 0) return 0;

  // 2. Identify already vectorized URLs in knowledge_chunks for this thread
  const existingRows = await pgClient`
    SELECT DISTINCT source_url FROM knowledge_chunks WHERE thread_id = ${threadId}
  `;
  const indexedUrls = new Set(existingRows.map((r: any) => r.source_url));

  // Only vectorize KB sources that have full content and are not yet in knowledge_chunks
  const sourcesToIndex = kbSources.filter(
    (s) => s.url && !indexedUrls.has(s.url) && s.content && s.content.trim().length > 0
  );

  if (sourcesToIndex.length === 0) return 0;

  console.log(
    `[RAG Service] Vectorizing ${sourcesToIndex.length} Knowledge Base source(s) into knowledge_chunks for thread: ${threadId}`
  );

  const embeddings = getEmbeddings();
  let totalChunksIndexed = 0;

  for (const source of sourcesToIndex) {
    // Process the FULL, COMPLETE content using RecursiveCharacterTextSplitter
    const textChunks = await chunkText(source.content);
    if (textChunks.length === 0) continue;

    try {
      const vectors = await embeddings.embedDocuments(textChunks);

      for (let i = 0; i < textChunks.length; i++) {
        const chunkContent = textChunks[i];
        const vec = vectors[i];
        if (!vec) continue;

        await pgClient`
          INSERT INTO knowledge_chunks (
            thread_id,
            source_url,
            source_title,
            content,
            chunk_index,
            embedding
          ) VALUES (
            ${threadId},
            ${source.url},
            ${source.title || "Knowledge Base Source"},
            ${chunkContent},
            ${i},
            ${JSON.stringify(vec)}::vector
          )
        `;
        totalChunksIndexed++;
      }
    } catch (err) {
      console.warn(`[RAG Service] Error embedding KB source "${source.title}":`, (err as Error).message);
    }
  }

  console.log(`[RAG Service] ✓ Successfully stored ${totalChunksIndexed} vector chunks for Knowledge Base.`);
  return totalChunksIndexed;
}

/**
 * Backward-compatible wrapper for indexing sources into knowledge_chunks.
 */
export async function indexSourcesForThread(
  threadId: string,
  sourcesList: SourceItem[]
): Promise<number> {
  return syncKnowledgeBaseVectors(threadId, sourcesList);
}

/**
 * Searches the top-K semantically relevant knowledge chunks for a query within a thread.
 * Uses PostgreSQL pgvector cosine similarity: 1 - (embedding <=> $queryVec).
 */
export async function searchRelevantChunks(
  threadId: string,
  query: string,
  topK = 4
): Promise<RetrievedChunk[]> {
  if (!isValidUuid(threadId) || !query || query.trim().length === 0) return [];

  try {
    const embeddings = getEmbeddings();
    const queryVec = await embeddings.embedQuery(query.trim());

    const rows = await pgClient`
      SELECT 
        id,
        source_url,
        source_title,
        content,
        1 - (embedding <=> ${JSON.stringify(queryVec)}::vector) AS similarity
      FROM knowledge_chunks
      WHERE thread_id = ${threadId}
      ORDER BY embedding <=> ${JSON.stringify(queryVec)}::vector
      LIMIT ${topK}
    `;

    return rows.map((r: any) => ({
      id: r.id,
      sourceUrl: r.source_url,
      sourceTitle: r.source_title,
      content: r.content,
      similarity: Number(r.similarity),
    }));
  } catch (err) {
    console.warn(`[RAG Service] Search query failed:`, (err as Error).message);
    return [];
  }
}
