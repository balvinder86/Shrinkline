// Ported from fetchAllRows in src/lib/pos/queries.ts — PostgREST caps
// an unpaginated read at 1000 rows. pmix_sales, labor_shifts,
// invoice_lines, waste_log, ingredient_cost_history, recipe_lines, and
// prep_recipe_lines all scale with days-in-range × menu items/shifts/
// invoices, so a query safely under 1000 rows for a narrow window can
// silently truncate — without an explicit order, to an arbitrary,
// non-deterministic subset — for a wider one or a restaurant with more
// volume. Every multi-row query in the chat tools pages through this
// instead of trusting a single request to return everything, so the
// assistant's numbers can't silently under-report real data the way an
// un-paginated query would.

const SUPABASE_PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await makeQuery(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    all.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}
