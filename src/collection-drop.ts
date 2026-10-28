import { parseBankDrag, type BankDocument } from "./question-bank";

/** Validate the entire native payload before assigning any logical question. */
export function planCollectionDrop(bank: BankDocument, raw: string, collectionId: string) {
  const collection = bank.collections.find(item => item.id === collectionId);
  if (!collection) throw Error("收藏夹已被删除，请刷新后重试");
  const requested = parseBankDrag(raw), byId = new Map(bank.entries.map(entry => [entry.id, entry]));
  const logical = new Map<string, BankDocument["entries"][number]>();
  for (const id of requested) {
    const entry = byId.get(id);
    if (!entry || entry.trashedAt) throw Error("拖入的题目已被删除或移入回收站，请刷新后重试");
    logical.set(entry.libraryId, entry);
  }
  const ids = [...logical.values()].filter(entry => !entry.collectionIds.includes(collectionId)).map(entry => entry.id);
  return { ids, total: logical.size, already: logical.size - ids.length, name: collection.name };
}
