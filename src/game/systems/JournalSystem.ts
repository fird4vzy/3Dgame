import type { EventBus } from '@core/events/EventBus';
import { emptyJournal, type JournalData } from '@engine/save/schema';
import {
  COURSES,
  POSTCARDS,
  RANKS,
  SOUVENIRS,
  STAMPS,
  medalFor,
  type Medal,
  type RankDef,
} from '../../data/activities';

export type JournalKind = 'stamp' | 'souvenir' | 'postcard' | 'cat';

export type { JournalData };

const MEDAL_ORDER: Medal[] = ['bronze', 'silver', 'gold'];

/**
 * The courier's journal: everything found, stamped, photographed and won.
 *
 * It is the game's second thread. The deliveries are the story and light the
 * planet; the journal is what there is to *do* on the way, and it is where the
 * player's standing comes from. Every entry is worth one point, deliveries
 * included, and the points buy two things that change how the game plays (see
 * `RANKS`) — so exploring is rewarded with something better than a number.
 *
 * Rules only; nothing here knows about the scene. It is told what happened
 * and announces what that changed.
 */
export class JournalSystem {
  private data: JournalData = emptyJournal();
  private deliveries = 0;

  constructor(private readonly bus: EventBus) {}

  /** Restore silently from a save. */
  restore(data: JournalData, deliveries: number): void {
    this.data = {
      ...emptyJournal(),
      ...data,
      stamps: [...data.stamps],
      souvenirs: [...data.souvenirs],
      postcards: [...data.postcards],
      catFriends: [...data.catFriends],
      courseBest: { ...data.courseBest },
    };
    this.deliveries = deliveries;
  }

  reset(): void {
    this.data = emptyJournal();
    this.deliveries = 0;
  }

  /** A copy, for the save file. */
  snapshot(): JournalData {
    return {
      ...this.data,
      stamps: [...this.data.stamps],
      souvenirs: [...this.data.souvenirs],
      postcards: [...this.data.postcards],
      catFriends: [...this.data.catFriends],
      courseBest: { ...this.data.courseBest },
    };
  }

  has(kind: JournalKind, id: string): boolean {
    return this.list(kind).includes(id);
  }

  count(kind: JournalKind): number {
    return this.list(kind).length;
  }

  get introSeen(): boolean {
    return this.data.introSeen;
  }

  markIntroSeen(): void {
    this.data.introSeen = true;
    this.bus.emit('journal:changed', this.summary('intro', 'intro'));
  }

  /** Record a find. Returns false if it was already in the book. */
  add(kind: JournalKind, id: string): boolean {
    const list = this.list(kind);
    if (list.includes(id)) return false;
    const before = this.rank;
    list.push(id);
    this.bus.emit('journal:changed', this.summary(kind, id));
    this.announceRank(before);
    return true;
  }

  /** A delivery counts toward her standing too. */
  setDeliveries(count: number): void {
    if (count === this.deliveries) return;
    const before = this.rank;
    this.deliveries = count;
    this.bus.emit('journal:changed', this.summary('delivery', String(count)));
    this.announceRank(before);
  }

  /**
   * Record a finished course. Returns the medal earned by this time, and
   * whether it beat her best.
   */
  finishCourse(id: string, seconds: number): { medal: Medal | null; best: boolean } {
    const course = COURSES.find((c) => c.id === id);
    if (!course) return { medal: null, best: false };
    const before = this.rank;
    const previous = this.data.courseBest[id];
    const best = previous === undefined || seconds < previous;
    if (best) this.data.courseBest[id] = seconds;
    const medal = medalFor(course, seconds);
    this.bus.emit('journal:changed', this.summary('course', id));
    this.announceRank(before);
    return { medal, best };
  }

  /** The best medal held on a course, if any. */
  medal(id: string): Medal | null {
    const course = COURSES.find((c) => c.id === id);
    const best = this.data.courseBest[id];
    return course && best !== undefined ? medalFor(course, best) : null;
  }

  courseBest(id: string): number | null {
    return this.data.courseBest[id] ?? null;
  }

  /** Entries in the book: one each for a find, a delivery, and a medal of any colour. */
  get points(): number {
    const medals = COURSES.filter((c) => this.medal(c.id) !== null).length;
    return (
      this.data.stamps.length +
      this.data.souvenirs.length +
      this.data.postcards.length +
      this.deliveries +
      medals
    );
  }

  /** Everything the book has room for. */
  get total(): number {
    return STAMPS.length + SOUVENIRS.length + POSTCARDS.length + COURSES.length + this.deliveryTotal;
  }

  /** Set by the scene: how many deliveries the story has. */
  deliveryTotal = 5;

  get rank(): RankDef {
    let current = RANKS[0]!;
    for (const rank of RANKS) if (this.points >= rank.at) current = rank;
    return current;
  }

  /** The rank after this one, or null at the top. */
  get nextRank(): RankDef | null {
    return RANKS.find((rank) => rank.at > this.points) ?? null;
  }

  /** Whether a reward has been earned. */
  owns(reward: 'compass' | 'geta'): boolean {
    return RANKS.some((rank) => rank.reward?.id === reward && this.points >= rank.at);
  }

  /** True when every page is full. */
  get complete(): boolean {
    return (
      this.points >= this.total &&
      COURSES.every((course) => MEDAL_ORDER.includes(this.medal(course.id) as Medal))
    );
  }

  private list(kind: JournalKind): string[] {
    switch (kind) {
      case 'stamp':
        return this.data.stamps;
      case 'souvenir':
        return this.data.souvenirs;
      case 'postcard':
        return this.data.postcards;
      case 'cat':
        return this.data.catFriends;
    }
  }

  private summary(kind: string, id: string): { kind: string; id: string; points: number; total: number; rank: string } {
    return { kind, id, points: this.points, total: this.total, rank: this.rank.title };
  }

  private announceRank(before: RankDef): void {
    const after = this.rank;
    if (after === before) return;
    this.bus.emit('journal:rankUp', {
      title: after.title,
      reward: after.reward?.name ?? null,
      note: after.reward?.note ?? null,
    });
  }
}
