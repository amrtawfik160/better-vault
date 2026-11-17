/** Paths of the notebook app. */
export const routes = {
  home: "/",
  study: "/study",
  notebook: (id: string) => `/notebook/${id}`,
} as const;
