export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { knowledge } = await import('./lib/knowledge');
  try {
    const sections = await knowledge.prepare();
    console.info(`[rag] Ready: ${sections} document sections indexed.`);
  } catch (error) {
    console.error('[rag] Startup indexing failed; the next search will retry:', error);
  }
}
