import { supabase } from "@/lib/supabase/client";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; label: string }
  | { type: "done" }
  | { type: "error"; error: string };

// Client keeps the whole conversation in memory and resends it every
// turn — the chat edge function is stateless, no server-side history
// in v1 (see supabase/functions/chat/index.ts).
//
// supabase.functions.invoke() buffers the whole response before
// returning it, which defeats streaming — it's built for one parsed
// JSON body, not a live ReadableStream. This does the same
// JWT-authenticated call by hand instead, then reads the edge
// function's SSE response chunk by chunk so text appears as the model
// actually generates it, not all at once after the whole tool-use
// loop finishes.
export async function streamChatMessage(
  messages: ChatMessage[],
  restaurantId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("Not signed in");

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const res = await fetch(`${supabaseUrl}/functions/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ restaurant_id: restaurantId, messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = `Chat request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent);
      } catch {
        // malformed chunk — skip rather than crash the whole stream
      }
    }
  }
}
