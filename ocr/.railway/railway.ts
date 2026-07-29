import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const thrasherspubInvoiceOcr = service("thrasherspub-invoice-ocr", {
    source: github("balvinder86/thrasherspub", {
      branch: "main",
      rootDirectory: "ocr",
    }),
    build: {
      // Repo-relative — only redeploy this service when its own code
      // actually changed, not on every push to the monorepo.
      watchPatterns: ["ocr/**"],
    },
    replicas: 1,
    env: {
      ANTHROPIC_API_KEY: preserve(),
      MINDEE_API_KEY: preserve(),
      MINDEE_MODEL_ID: preserve(),
      OCR_SERVICE_TOKEN: preserve(),
      PORT: preserve(),
      SUPABASE_SERVICE_ROLE_KEY: preserve(),
      SUPABASE_URL: preserve(),
    },
  });

  return project("thrasherspub-invoice-ocr", {
    resources: [thrasherspubInvoiceOcr],
  });
});
