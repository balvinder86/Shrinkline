// Document-type classification — invoice vs credit memo vs statement
// vs unclear. Mindee's custom extraction model has no raw-text or
// document-class field, so this is a separate, cheap Claude vision
// call rather than a heuristic on structured fields alone (which
// can't reliably tell a statement from an invoice — both can have a
// total and line items).

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export type DocumentType = "invoice" | "credit_memo" | "statement" | "unclear";

const VALID_TYPES: DocumentType[] = ["invoice", "credit_memo", "statement", "unclear"];

const CLASSIFY_TOOL = {
  name: "classify_document",
  description: "Record the document type classification for this attachment.",
  input_schema: {
    type: "object" as const,
    properties: {
      document_type: {
        type: "string" as const,
        enum: VALID_TYPES,
        description:
          "invoice: a bill for goods/services owed to a vendor, with a single invoice number and total due. " +
          "credit_memo: a document that reduces an amount owed (a refund, credit, or return), not a new bill. " +
          "statement: a summary/recap of multiple invoices or transactions over a period — not a single bill. " +
          "unclear: none of the above, illegible, or not a business billing document at all.",
      },
    },
    required: ["document_type"],
  },
};

// Never throws — a classification failure shouldn't block review of
// an extraction Mindee already succeeded on. Any error or timeout
// degrades to 'unclear', which the caller treats like a low-confidence
// result (still reaches ocr_status='ready', just flagged for a human
// to look closer).
export async function classifyDocument(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<{ documentType: DocumentType }> {
  try {
    const data = fileBuffer.toString("base64");
    const contentBlock =
      mimeType === "application/pdf"
        ? {
            type: "document" as const,
            source: { type: "base64" as const, media_type: "application/pdf" as const, data },
          }
        : {
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (mimeType === "image/png" ? "image/png" : "image/jpeg") as
                | "image/png"
                | "image/jpeg",
              data,
            },
          };

    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 200,
        tools: [CLASSIFY_TOOL],
        tool_choice: { type: "tool", name: "classify_document" },
        messages: [
          {
            role: "user",
            content: [contentBlock, { type: "text", text: "Classify this document." }],
          },
        ],
      },
      { timeout: 15000 },
    );

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    const candidate = (toolUse?.input as { document_type?: string } | undefined)?.document_type;
    if (candidate && (VALID_TYPES as string[]).includes(candidate)) {
      return { documentType: candidate as DocumentType };
    }
    return { documentType: "unclear" };
  } catch (e) {
    console.error("[classify] document classification failed, defaulting to 'unclear':", e);
    return { documentType: "unclear" };
  }
}
