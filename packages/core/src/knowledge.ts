import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatTool, Embedder } from './types';

const DOCUMENT_FILE = /\.(md|txt)$/i;
const MAX_CHUNK_LENGTH = 1500;
const EMBED_BATCH_SIZE = 32;

export interface DocumentChunk {
  file: string;
  /** Heading path, e.g. "FAQ › Refund"; '' before the first heading. */
  heading: string;
  text: string;
}

export interface SearchResult extends DocumentChunk {
  /** Cosine similarity to the query, -1..1. */
  score: number;
}

interface IndexedChunk extends DocumentChunk {
  vector: number[];
}

/** Splits a document by Markdown heading, then groups each section's paragraphs up to maxLength. */
export function chunkDocument(
  file: string,
  text: string,
  maxLength = MAX_CHUNK_LENGTH,
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const headings: string[] = [];
  let lines: string[] = [];

  const flush = () => {
    const heading = headings.filter(Boolean).join(' › ');
    let current = '';
    for (const paragraph of lines.join('\n').split(/\n\s*\n/)) {
      const p = paragraph.trim();
      if (!p) continue;
      if (current && current.length + 2 + p.length > maxLength) {
        chunks.push({ file, heading, text: current });
        current = p;
      } else {
        current = current ? `${current}\n\n${p}` : p;
      }
    }
    if (current) chunks.push({ file, heading, text: current });
    lines = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (!match) {
      lines.push(line);
      continue;
    }
    flush();
    const level = match[1]!.length;
    headings.length = level - 1;
    headings[level - 1] = match[2]!;
  }
  flush();
  return chunks;
}

export interface KnowledgeBaseOptions {
  /** Folder with the .md / .txt documents. */
  dir: string;
  embed: Embedder;
}

/**
 * The documents in a folder, searchable by meaning. prepare() embeds sections ahead of searches;
 * the index stays in memory and rebuilds on the next search after a file changes.
 */
export class KnowledgeBase {
  readonly dir: string;
  readonly #embed: Embedder;
  #index?: { signature: string; chunks: Promise<IndexedChunk[]> };

  constructor({ dir, embed }: KnowledgeBaseOptions) {
    this.dir = dir;
    this.#embed = embed;
  }

  /** Document file names, sorted; [] when the folder is missing. */
  files(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((file) => DOCUMENT_FILE.test(file))
        .sort();
    } catch {
      return [];
    }
  }

  /** Prepare the document index without embedding a query; return the number of sections. */
  async prepare(): Promise<number> {
    return (await this.#load()).length;
  }

  async search(
    query: string,
    { limit = 4, signal }: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<SearchResult[]> {
    const chunks = await this.#load();
    if (chunks.length === 0) return [];
    const [queryVector = []] = await this.#embed([query], signal);
    return chunks
      .map(({ vector, ...chunk }) => ({ ...chunk, score: cosine(queryVector, vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  #load(): Promise<IndexedChunk[]> {
    const files = this.files();
    const signature = files
      .map((file) => {
        const { size, mtimeMs } = statSync(join(this.dir, file));
        return `${file}:${size}:${mtimeMs}`;
      })
      .join('|');
    if (this.#index?.signature === signature) return this.#index.chunks;

    const chunks = this.#build(files);
    this.#index = { signature, chunks };
    // Forget a failed build so the next search retries it.
    chunks.catch(() => {
      if (this.#index?.chunks === chunks) this.#index = undefined;
    });
    return chunks;
  }

  async #build(files: string[]): Promise<IndexedChunk[]> {
    const chunks = files.flatMap((file) =>
      chunkDocument(file, readFileSync(join(this.dir, file), 'utf8')),
    );
    const vectors: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      vectors.push(...(await this.#embed(batch.map(embeddingText))));
    }
    return chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] ?? [] }));
  }
}

/** The `search_documents` tool the model calls to look things up in the knowledge base. */
export function searchDocumentsTool(kb: KnowledgeBase): ChatTool {
  return {
    name: 'search_documents',
    description:
      `Search the reference documents (${kb.files().join(', ')}), such as policies and FAQs. ` +
      'Call it whenever the question may be answered by them, and answer from the returned ' +
      'excerpts. If the excerpts do not contain the answer, say you do not know.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for, as a short question or keywords.',
        },
      },
      required: ['query'],
    },
    async run(args, signal) {
      const query = (args as { query?: unknown } | null)?.query;
      if (typeof query !== 'string' || !query.trim()) {
        return 'Error: a non-empty "query" string is required';
      }
      const results = await kb.search(query.trim(), { signal });
      if (results.length === 0) return 'No matching documents.';
      return results
        .map((r) => `[${[r.file, r.heading].filter(Boolean).join(' › ')}]\n${r.text}`)
        .join('\n\n---\n\n');
    },
  };
}

function embeddingText({ heading, text }: DocumentChunk): string {
  return heading ? `${heading}\n${text}` : text;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}
