import type { EventBus } from '@core/events/EventBus';
import type { DialogueNode } from '../../data/content';

/**
 * Linear dialogue playback.
 *
 * Deliberately simple: the reference tells its stories through staging and
 * animation, with two or three lines of text as punctuation. A branching
 * dialogue graph would be architecture in search of a problem here — the
 * `advance`/`skip` surface is the same either way, so branching can be added
 * behind it later without touching callers.
 */
export class DialogueSystem {
  private nodes: DialogueNode[] = [];
  private index = 0;
  private id: string | null = null;
  private resolve: (() => void) | null = null;

  constructor(private readonly bus: EventBus) {}

  get isActive(): boolean {
    return this.id !== null;
  }

  get currentLine(): DialogueNode | null {
    return this.nodes[this.index] ?? null;
  }

  /** Resolves when the conversation finishes or is skipped. */
  start(id: string, nodes: DialogueNode[]): Promise<void> {
    if (this.isActive) this.finish();
    if (nodes.length === 0) return Promise.resolve();

    this.id = id;
    this.nodes = nodes;
    this.index = 0;

    this.bus.emit('dialogue:started', { id });
    this.emitLine();

    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Advance one line, finishing the conversation after the last. */
  advance(): void {
    if (!this.isActive) return;
    this.index++;
    if (this.index >= this.nodes.length) {
      this.finish();
      return;
    }
    this.emitLine();
  }

  skip(): void {
    if (this.isActive) this.finish();
  }

  private emitLine(): void {
    const line = this.nodes[this.index];
    if (!line) return;
    this.bus.emit('dialogue:line', {
      speaker: line.speaker,
      text: line.text,
      index: this.index,
      total: this.nodes.length,
    });
  }

  private finish(): void {
    const id = this.id;
    this.id = null;
    this.nodes = [];
    this.index = 0;

    if (id) this.bus.emit('dialogue:ended', { id });

    const resolve = this.resolve;
    this.resolve = null;
    resolve?.();
  }
}
