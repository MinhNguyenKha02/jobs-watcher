// src/services/profile/retrieval/aho-corasick.ts

import type { AnchorId, MatchSignal } from '../types/retrieval.types.js';

import { retrievalPolicy } from './policies/retrieval.policy.js';
import { MatchSignalBuilder } from './scoring/match-signal.builder.js';

interface Output {
  anchorId: AnchorId;

  pattern: string;

  weight: number;

  source: 'canonical' | 'adjacent' | 'vendor' | 'template';
}

class Node {
  children = new Map<string, Node>();

  fail: Node | null = null;

  outputs: Output[] = [];
}

export class AhoCorasick {
  private readonly builder = new MatchSignalBuilder(retrievalPolicy);

  private root = new Node();

  insert(output: Output) {
    let node = this.root;

    for (const char of output.pattern) {
      if (!node.children.has(char)) {
        node.children.set(char, new Node());
      }

      node = node.children.get(char)!;
    }

    node.outputs.push(output);
  }

  buildFallbackLinks() {
    const queue: Node[] = [];

    for (const child of this.root.children.values()) {
      child.fail = this.root;

      queue.push(child);
    }

    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];

      for (const [char, child] of current.children) {
        let fallback: Node | null = current.fail;

        while (fallback && !fallback.children.has(char)) {
          fallback = fallback.fail;
        }

        child.fail = fallback?.children.get(char) ?? this.root;

        child.outputs.push(...child.fail.outputs);

        queue.push(child);
      }
    }
  }

  traverse(text: string): Map<AnchorId, MatchSignal> {
    const matches = new Map<AnchorId, MatchSignal>();

    let node = this.root;

    for (const char of text) {
      while (node !== this.root && !node.children.has(char)) {
        node = node.fail!;
      }

      node = node.children.get(char) ?? this.root;

      for (const output of node.outputs) {
        let existing = matches.get(output.anchorId);

        if (!existing) {
          existing = this.builder.create(output.anchorId);

          matches.set(output.anchorId, existing);
        }

        this.builder.appendLexicalHit({
          signal: existing,
          pattern: output.pattern,
          source: output.source,
          weight: output.weight,
          start: 0,
          end: 0,
        });
      }
    }

    return matches;
  }
}
