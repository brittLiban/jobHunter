const defaultVerbRotation = [
  "built",
  "developed",
  "implemented",
  "designed",
  "created",
  "improved",
  "automated",
  "integrated",
] as const;

const defaultOpeners = [
  "I bring",
  "My background includes",
  "In recent roles, I",
  "I am especially drawn to",
  "This role stands out because",
  "What makes me effective here is",
] as const;

export type VariationPlan = {
  preferredVerb: string;
  opening: string;
};

export class PhraseVariationTracker {
  private readonly recentVerbs: string[] = [];
  private readonly recentOpenings: string[] = [];

  constructor(
    private readonly verbs: readonly string[] = defaultVerbRotation,
    private readonly openings: readonly string[] = defaultOpeners,
    private readonly maxHistory = 6,
  ) {}

  nextPlan(): VariationPlan {
    const preferredVerb = this.nextUnused(this.verbs, this.recentVerbs);
    const opening = this.nextUnused(this.openings, this.recentOpenings);
    this.remember(this.recentVerbs, preferredVerb);
    this.remember(this.recentOpenings, opening);

    return {
      preferredVerb,
      opening,
    };
  }

  noteUsage(plan: VariationPlan): void {
    this.remember(this.recentVerbs, plan.preferredVerb);
    this.remember(this.recentOpenings, plan.opening);
  }

  snapshot(): { verbs: string[]; openings: string[] } {
    return {
      verbs: [...this.recentVerbs],
      openings: [...this.recentOpenings],
    };
  }

  private nextUnused(source: readonly string[], recent: string[]): string {
    const candidate = source.find((item) => !recent.includes(item));
    return candidate ?? source[0];
  }

  private remember(target: string[], value: string): void {
    target.unshift(value);
    if (target.length > this.maxHistory) {
      target.length = this.maxHistory;
    }
  }
}
