import type { FieldKeyHandlers } from "./extensions";
import type { Block, BlockKind, Edition } from "./model";
import type { RichDoc } from "./rich";
import type { CaretIntent } from "./RichField";

/** 块组件调用的稳定接口；实现内部通过 ref 读取最新状态，保证 memo 不失效。 */
export interface BlockApi {
  activate(blockId: string, field: string, intent: CaretIntent): void;
  change(blockId: string, field: string, doc: RichDoc): void;
  update(blockId: string, recipe: (block: Block) => Block, coalesce?: string): void;
  select(blockId: string): void;
  keys(blockId: string, field: string): FieldKeyHandlers;
  insertAfter(blockId: string | null, kind: BlockKind, variant?: string): void;
  remove(blockId: string): void;
}

export interface Selection { blockId: string; field: string | null; intent?: CaretIntent; serial: number }

export function fieldsOf(block: Block, edition: Edition): string[] {
  switch (block.kind) {
    case "heading": case "text": case "note": return ["text"];
    case "question": {
      const fields = ["stem", ...block.options.map(o => `opt:${o.id}`)];
      if (edition === "teacher") {
        if (block.qtype === "essay" || (block.qtype === "blank" && !hasBlankNode(block.stem))) fields.push("answer");
        fields.push("analysis");
      }
      return fields;
    }
    case "figure": return block.src ? ["caption"] : [];
    case "formula": return ["latex"];
    default: return [];
  }
}

export function hasBlankNode(doc: RichDoc): boolean {
  const visit = (nodes: RichDoc["content"]): boolean => nodes.some(node => node.type === "blank" || (node.content ? visit(node.content) : false));
  return visit(doc.content);
}
