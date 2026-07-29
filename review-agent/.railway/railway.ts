import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const thrasherspubReviewAgent = service("thrasherspub-review-agent", {
    source: github("balvinder86/thrasherspub", {
      branch: "main",
      rootDirectory: "review-agent",
    }),
    build: {
      // Repo-relative — only redeploy this service when its own code
      // actually changed, not on every push to the monorepo.
      watchPatterns: ["review-agent/**"],
    },
    replicas: 1,
    env: {
      ANTHROPIC_API_KEY: preserve(),
      REVIEW_AGENT_SERVICE_TOKEN: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });

  return project("thrasherspub-review-agent", {
    resources: [thrasherspubReviewAgent],
  });
});
