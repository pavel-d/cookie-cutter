export interface PopupStats {
  page: number;
  total: number;
}

export type StatsMessage =
  { type: "popup-closed" } | { type: "get-popup-stats" };

export interface StatsStorage {
  getTotal(): Promise<number>;
  getPage(documentId: string): Promise<number>;
  save(total: number, documentId: string, page: number): Promise<void>;
}

export class PopupCounter {
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: StatsStorage) {}

  record(documentId: string): Promise<PopupStats> {
    const result = this.pending.then(async () => {
      const total = (await this.storage.getTotal()) + 1;
      const page = (await this.storage.getPage(documentId)) + 1;
      await this.storage.save(total, documentId, page);
      return { total, page };
    });
    // A failed write rejects its caller; subsequent records can retry storage.
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async read(documentId: string | undefined): Promise<PopupStats> {
    await this.pending;
    return {
      total: await this.storage.getTotal(),
      page: documentId ? await this.storage.getPage(documentId) : 0,
    };
  }
}
