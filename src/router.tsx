import { createBrowserRouter, Navigate, Outlet, useLocation, useParams } from "react-router";
import { RouteError } from "@/components/common/route-error";
import { AppProviders } from "@/components/providers/app-providers";
import { routes } from "@/lib/routes";

function StudyRedirect() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("view", "study");
  return <Navigate to={{ pathname: routes.home, search: params.toString(), hash }} replace />;
}

/** The app's pages; their paths come from lib/routes.ts. Each page loads on first visit. */
export const router = createBrowserRouter([
  // A sign-in popup's landing page, without the app around it.
  {
    path: "/oauth/callback",
    lazy: async () => ({ Component: (await import("./oauth-callback")).OAuthCallback }),
  },
  {
    element: (
      <AppProviders>
        <Outlet />
      </AppProviders>
    ),
    children: [
      {
        // The sidebar's frame, one route above the pages so it stays as you move between them.
        lazy: async () => ({ Component: (await import("@/components/shell/app-frame")).AppFrame }),
        children: [
          {
            path: routes.home,
            errorElement: <RouteError />,
            lazy: async () => ({
              Component: (await import("@/components/home/notebook-home")).NotebookHome,
            }),
          },
          {
            path: "/study",
            errorElement: <RouteError />,
            Component: StudyRedirect,
          },
          {
            path: routes.notebook(":id"),
            errorElement: <RouteError />,
            lazy: async () => {
              const { Workspace } = await import("@/components/workspace/workspace");
              function NotebookPage() {
                const { id = "" } = useParams();
                // A new key per notebook, so switching notebooks starts from a clean screen.
                return <Workspace key={id} notebookId={id} />;
              }
              return { Component: NotebookPage };
            },
          },
          {
            path: "*",
            errorElement: <RouteError />,
            lazy: async () => ({
              Component: (await import("@/components/home/notebook-home")).NotebookHome,
            }),
          },
        ],
      },
    ],
  },
]);
