import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const thrasherspubEmailIngest = service("thrasherspub-email-ingest", {
    source: github("balvinder86/thrasherspub", {
      branch: "main",
      rootDirectory: "email-ingest",
    }),
    build: {
      // Repo-relative — only redeploy this service when its own code
      // actually changed, not on every push to the monorepo.
      watchPatterns: ["email-ingest/**"],
    },
    replicas: 1,
    env: {
      GMAIL_CLIENT_ID: preserve(),
      GMAIL_CLIENT_SECRET: preserve(),
      OCR_SERVICE_TOKEN: preserve(),
      OCR_SERVICE_URL: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });

  return project("thrasherspub-email-ingest", {
    resources: [thrasherspubEmailIngest],
  });
});
