import { parseRuleset } from "./ruleset";

export interface RulesDocument {
  revision: string;
  rules: unknown;
}

export interface CachedRules {
  document: RulesDocument;
  checkedAt: number;
}

export interface RulesStore {
  read(): Promise<CachedRules | undefined>;
  write(value: CachedRules): Promise<void>;
}

export interface RulesSource {
  fetch(revision?: string): Promise<RulesDocument | null>;
}

export function parseRulesDocument(value: unknown): RulesDocument {
  if (
    !value ||
    typeof value !== "object" ||
    !("revision" in value) ||
    !("rules" in value) ||
    typeof value.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.revision)
  )
    throw new Error("Invalid rules document.");
  parseRuleset(value.rules);
  return { revision: value.revision, rules: value.rules };
}

// The source and persistence adapters own HTTP and browser storage. This use
// case only replaces the cached rules after a complete document validates.
export class UpdateRules {
  private pending: Promise<CachedRules> | undefined;

  constructor(
    private readonly store: RulesStore,
    private readonly source: RulesSource,
    private readonly now: () => number,
  ) {}

  cached(): Promise<CachedRules | undefined> {
    return this.store.read();
  }

  refresh(): Promise<CachedRules> {
    if (!this.pending) {
      this.pending = this.refreshOnce().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private async refreshOnce(): Promise<CachedRules> {
    const cached = await this.store.read();
    const response = await this.source.fetch(cached?.document.revision);
    if (!response && !cached)
      throw new Error("Rules server returned no initial rules.");
    const updated = {
      document: response ? parseRulesDocument(response) : cached!.document,
      checkedAt: this.now(),
    };
    await this.store.write(updated);
    return updated;
  }
}
