import { parseRuleset } from "./ruleset";

export interface RulesDocument {
  revision: string;
  rules: unknown;
}

export interface CachedRules {
  document: SignedRulesDocument;
  checkedAt: number;
}

export interface SignedRulesDocument {
  revision: string;
  payload: string;
  signature: string;
}

export interface ActiveRules {
  document: RulesDocument;
  checkedAt: number;
}

export type RulesVerifier = (value: unknown) => Promise<RulesDocument>;

export interface RulesStore {
  read(): Promise<CachedRules | undefined>;
  write(value: CachedRules): Promise<void>;
}

export interface RulesSource {
  fetch(revision?: string): Promise<SignedRulesDocument | null>;
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
  private pending: Promise<ActiveRules> | undefined;

  constructor(
    private readonly store: RulesStore,
    private readonly source: RulesSource,
    private readonly verify: RulesVerifier,
    private readonly now: () => number,
  ) {}

  async cached(): Promise<ActiveRules | undefined> {
    const cached = await this.store.read();
    if (!cached) return undefined;
    return {
      document: await this.verify(cached.document),
      checkedAt: cached.checkedAt,
    };
  }

  refresh(): Promise<ActiveRules> {
    if (!this.pending) {
      this.pending = this.refreshOnce().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  private async refreshOnce(): Promise<ActiveRules> {
    const cached = await this.store.read();
    const previous = cached ? await this.verify(cached.document) : undefined;
    const response = await this.source.fetch(previous?.revision);
    if (!response && !cached)
      throw new Error("Rules server returned no initial rules.");
    const document = response ? await this.verify(response) : previous!;
    const checkedAt = this.now();
    await this.store.write({
      document: response ?? cached!.document,
      checkedAt,
    });
    return { document, checkedAt };
  }
}
