import type { PlasticMethod } from "./methods.js";

export const groupMethodsByOwner = (methodList: PlasticMethod[]) => {
  const groups = new Map<string, Array<{ id: string; title?: string; description?: string }>>();
  for (const method of methodList) {
    const owner = `${method.owner.kind}:${method.owner.id}`;
    const items = groups.get(owner) ?? [];
    const item: { id: string; title?: string; description?: string } = {
      id: method.id,
      title: method.title
    };
    if (method.description) {
      item.description = method.description;
    }
    items.push(item);
    groups.set(owner, items);
  }
  return [...groups.entries()].map(([owner, items]) => ({ owner, count: items.length, methods: items }));
};
