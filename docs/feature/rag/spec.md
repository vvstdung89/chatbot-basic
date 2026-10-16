# Spec: document search (RAG) with tool calling

## Goal

Let the assistant answer from the owner's documents (policy, FAQ, ...). When a question relates to
them, the model calls a search tool, gets the relevant excerpts and answers from them.

## Behaviour

- Documents live in `apps/web/knowledge/`. Every `.md` and `.txt` file there is searchable; add,
  edit or delete files at any time (no restart, no build step).
- Files are split into sections: by Markdown heading, and long sections further by paragraph
  (about 1,500 characters max). Each section remembers its file and heading path.
- Sections are embedded with an OpenRouter embedding model (`OPENROUTER_EMBEDDING_MODEL`, default
  `baai/bge-m3`, multilingual). The Node server prepares the index at startup and shares it with
  chat requests in memory; it is rebuilt on the next search when any file is added, removed or
  changed. Failed startup indexing is logged and retried on the next search.
- The model is offered one tool, `search_documents({ query })`, whose description names the
  available files. The tool embeds the query and returns the 4 most similar sections (cosine
  similarity), each labelled `[file › heading]`.
- The model may call tools several times; after 5 rounds it must answer without tools. Only the
  final answer text is streamed to the UI; the HTTP API does not change.
- No documents in the folder: the tool is not offered and chat works as before.
- A failing tool (e.g. embedding API error) is reported to the model as an error result and logged;
  the chat request does not fail because of it.
- Providers without tool support ignore tools (`echo` does).

## Out of scope

- PDF / Word files (convert them to `.md` or `.txt`).
- Persisting the index to disk, or a vector database.
- Showing sources or "searching…" status in the UI.
