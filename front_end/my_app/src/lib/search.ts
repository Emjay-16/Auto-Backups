export function matchesQuery(query: string, values: Array<number | string | null | undefined>): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return values.some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery));
}
