export const CATEGORIES = [
  "Makan & Minum",
  "Transportasi",
  "Belanja",
  "Tagihan & Utilitas",
  "Hiburan",
  "Kesehatan",
  "Pendidikan",
  "Rumah Tangga",
  "Lainnya",
] as const;

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_EMOJI: Record<Category, string> = {
  "Makan & Minum": "🍜",
  Transportasi: "🛵",
  Belanja: "🛍️",
  "Tagihan & Utilitas": "💡",
  Hiburan: "🎬",
  Kesehatan: "💊",
  Pendidikan: "📚",
  "Rumah Tangga": "🏠",
  Lainnya: "📦",
};

/** "🍜 Makan & Minum" — for chat messages. */
export function categoryLabel(category: string): string {
  return `${CATEGORY_EMOJI[category as Category] ?? "📦"} ${category}`;
}
