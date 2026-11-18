/** Paths of the notebook app. */
export const routes = {
  home: "/",
  study: "/?view=study",
  notebook: (id: string) => `/notebook/${id}`,
} as const;
