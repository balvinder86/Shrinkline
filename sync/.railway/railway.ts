import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const thrasherspubToastSync = service("thrasherspub-toast-sync", {
    source: github("balvinder86/thrasherspub", {
      branch: "main",
      rootDirectory: "sync",
    }),
    build: {
      // Repo-relative — only redeploy this service when its own code
      // actually changed, not on every push to the monorepo (frontend
      // changes, other services, etc).
      watchPatterns: ["sync/**"],
    },
    replicas: 1,
    env: {
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });

  return project("thrasherspub-toast-sync", {
    resources: [thrasherspubToastSync],
  });
});
