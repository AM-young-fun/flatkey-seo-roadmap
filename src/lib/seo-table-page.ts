export const SEO_PAGE_SIZE = 10;

export function seoTablePage<T>(rows: readonly T[], requestedPage: number, selectedIndex = -1) {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / SEO_PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, selectedIndex >= 0 ? Math.floor(selectedIndex / SEO_PAGE_SIZE) + 1 : requestedPage));
  const offset = (page - 1) * SEO_PAGE_SIZE;
  return { rows: rows.slice(offset, offset + SEO_PAGE_SIZE), page, total, pageCount };
}

export type SeoTablePagination = Omit<ReturnType<typeof seoTablePage>, "rows">;
