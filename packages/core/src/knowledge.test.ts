import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunkDocument, KnowledgeBase, searchDocumentsTool } from './knowledge';
import type { Embedder } from './types';

// Fake embedding: how often each vocabulary word appears, so similarity follows shared words.
const VOCAB = ['refund', 'shipping', 'account'];

function fakeEmbedder() {
  const calls: string[][] = [];
  const embed: Embedder = async (texts) => {
    calls.push(texts);
    return texts.map((text) => VOCAB.map((word) => text.toLowerCase().split(word).length - 1));
  };
  return { embed, calls };
}

describe('chunkDocument', () => {
  it('splits Markdown by heading, keeping the heading path and skipping empty sections', () => {
    const text = [
      '# FAQ',
      'Intro line.',
      '',
      '## Refund ##',
      'Refunds take 7 days.',
      '',
      '## Shipping',
      '### Fees',
      'Free over 300k.',
    ].join('\n');

    expect(chunkDocument('faq.md', text)).toEqual([
      { file: 'faq.md', heading: 'FAQ', text: 'Intro line.' },
      { file: 'faq.md', heading: 'FAQ › Refund', text: 'Refunds take 7 days.' },
      { file: 'faq.md', heading: 'FAQ › Shipping › Fees', text: 'Free over 300k.' },
    ]);
  });

  it('groups paragraphs of long sections up to the max length', () => {
    const paragraph = 'a'.repeat(10);
    const text = [paragraph, paragraph, paragraph].join('\n\n');

    expect(chunkDocument('notes.txt', text, 25)).toEqual([
      { file: 'notes.txt', heading: '', text: `${paragraph}\n\n${paragraph}` },
      { file: 'notes.txt', heading: '', text: paragraph },
    ]);
  });
});

describe('KnowledgeBase', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'knowledge-'));
    writeFileSync(join(dir, 'faq.md'), '# Refund\nAsk for a refund within 7 days.\n');
    writeFileSync(join(dir, 'policy.txt'), 'Shipping is free over 300k. Shipping takes 3 days.');
    writeFileSync(join(dir, 'image.png'), 'not a document');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lists .md and .txt files, and nothing for a missing folder', () => {
    const { embed } = fakeEmbedder();
    expect(new KnowledgeBase({ dir, embed }).files()).toEqual(['faq.md', 'policy.txt']);
    expect(new KnowledgeBase({ dir: join(dir, 'missing'), embed }).files()).toEqual([]);
  });

  it('returns the most similar sections first', async () => {
    const { embed } = fakeEmbedder();
    const results = await new KnowledgeBase({ dir, embed }).search('shipping fee?', { limit: 1 });

    expect(results).toEqual([
      {
        file: 'policy.txt',
        heading: '',
        text: 'Shipping is free over 300k. Shipping takes 3 days.',
        score: expect.closeTo(1),
      },
    ]);
  });

  it('embeds documents once, and again only after a file changes', async () => {
    const { embed, calls } = fakeEmbedder();
    const kb = new KnowledgeBase({ dir, embed });

    await kb.search('refund');
    await kb.search('shipping');
    expect(calls).toEqual([
      [
        'Refund\nAsk for a refund within 7 days.',
        'Shipping is free over 300k. Shipping takes 3 days.',
      ],
      ['refund'],
      ['shipping'],
    ]);

    writeFileSync(join(dir, 'faq.md'), '# Account\nReset your account password in Settings.\n');
    const [top] = await kb.search('account');
    expect(top?.heading).toBe('Account');
    expect(calls.slice(3)).toEqual([
      [
        'Account\nReset your account password in Settings.',
        'Shipping is free over 300k. Shipping takes 3 days.',
      ],
      ['account'],
    ]);
  });

  it('prepares documents before searching and reuses them until a file changes', async () => {
    const { embed, calls } = fakeEmbedder();
    const kb = new KnowledgeBase({ dir, embed });

    expect(await kb.prepare()).toBe(2);
    await kb.prepare();
    expect(calls).toHaveLength(1);

    const [top] = await kb.search('refund');
    expect(top?.heading).toBe('Refund');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['refund']);

    writeFileSync(join(dir, 'faq.md'), '# Account\nReset your account password in Settings.\n');
    const [updated] = await kb.search('account');
    expect(updated?.heading).toBe('Account');
    expect(calls).toHaveLength(4);
    expect(calls[2]?.[0]).toContain('Reset your account password');
  });

  it('shares an in-flight preparation with concurrent searches', async () => {
    const { embed, calls } = fakeEmbedder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const kb = new KnowledgeBase({
      dir,
      embed: async (texts) => {
        const vectors = await embed(texts);
        await gate;
        return vectors;
      },
    });

    const prepared = kb.prepare();
    const searched = kb.search('refund');
    expect(calls).toHaveLength(1);
    release();
    await prepared;
    expect((await searched)[0]?.heading).toBe('Refund');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(['refund']);
  });

  it('retries a failed preparation on the next search', async () => {
    const { embed, calls } = fakeEmbedder();
    let fail = true;
    const kb = new KnowledgeBase({
      dir,
      embed: async (texts) => {
        if (fail) throw new Error('Embedding unavailable');
        return embed(texts);
      },
    });

    await expect(kb.prepare()).rejects.toThrow('Embedding unavailable');
    fail = false;
    expect((await kb.search('refund'))[0]?.heading).toBe('Refund');
    expect(calls).toHaveLength(2);
  });

  it('prepares an empty folder without calling the embedder', async () => {
    const { embed, calls } = fakeEmbedder();
    const kb = new KnowledgeBase({ dir: join(dir, 'missing'), embed });
    expect(await kb.prepare()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('returns nothing without calling the embedder when there are no documents', async () => {
    const { embed, calls } = fakeEmbedder();
    expect(await new KnowledgeBase({ dir: join(dir, 'missing'), embed }).search('refund')).toEqual(
      [],
    );
    expect(calls).toEqual([]);
  });
});

describe('searchDocumentsTool', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'knowledge-'));
    writeFileSync(join(dir, 'faq.md'), '# FAQ\n## Refund\nAsk for a refund within 7 days.\n');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('names the available documents in its description', () => {
    const tool = searchDocumentsTool(new KnowledgeBase({ dir, embed: fakeEmbedder().embed }));
    expect(tool.name).toBe('search_documents');
    expect(tool.description).toContain('faq.md');
  });

  it('returns labelled excerpts', async () => {
    const tool = searchDocumentsTool(new KnowledgeBase({ dir, embed: fakeEmbedder().embed }));
    expect(await tool.run({ query: 'refund' })).toBe(
      '[faq.md › FAQ › Refund]\nAsk for a refund within 7 days.',
    );
  });

  it('asks for a query when it is missing', async () => {
    const tool = searchDocumentsTool(new KnowledgeBase({ dir, embed: fakeEmbedder().embed }));
    expect(await tool.run({})).toMatch(/^Error: .*query/);
  });
});
