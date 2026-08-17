import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MessageCircle, Send, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { streamChatMessage, type ChatMessage } from "@/lib/chat/queries";
import { useRestaurantIds } from "@/lib/supabase/scope";
import { cn } from "@/lib/utils";

const EXAMPLE_PROMPTS = [
  "What's my food cost variance this month?",
  "Which vendor am I spending the most with?",
  "Any ingredients with a big price jump lately?",
  "What's my most sold item?",
];

// Assistant replies can include markdown-style page links — [Label](/path)
// — per the chat edge function's system prompt (AVAILABLE PAGES). Parses
// just that one pattern (no other markdown) and renders it as a real
// in-app Link, closing the panel on click so the user actually lands
// on the page rather than reading it behind an open sheet. Matches
// against partial/still-streaming text fine — an incomplete
// "[Recipes](/reci" simply doesn't match yet and renders as plain
// text until the closing ")" arrives.
const PAGE_LINK_PATTERN = /\[([^\]]+)\]\((\/[a-zA-Z0-9\-/]*)\)/g;

function MessageContent({ content, onNavigate }: { content: string; onNavigate: () => void }) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of content.matchAll(PAGE_LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(content.slice(lastIndex, index));
    nodes.push(
      <Link
        key={key++}
        to={match[2]}
        onClick={onNavigate}
        className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
      >
        {match[1]}
      </Link>,
    );
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));
  return <>{nodes}</>;
}

export function ChatWidget() {
  const restaurantId = useRestaurantIds()[0];
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Non-null while a response is streaming in — the in-progress text,
  // committed into `messages` once the stream finishes. Kept separate
  // from `messages` so a live-updating bubble doesn't mean re-rendering
  // (and re-diffing) the whole history on every token.
  const [streamingText, setStreamingText] = useState<string | null>(null);
  // "Checking your P&L…" while a tool call is in flight and no
  // visible text has arrived yet for the current turn.
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, statusLabel]);

  // Stop paying for tokens nobody's listening to if the widget itself
  // is ever torn down mid-stream (it isn't today — mounted once at the
  // app root — but this is the correct thing to do if that changes).
  useEffect(() => () => abortRef.current?.abort(), []);

  function submit(text: string) {
    const content = text.trim();
    if (!content || streamingText != null || !restaurantId) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setStreamingText("");
    setStatusLabel(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    streamChatMessage(
      next,
      restaurantId,
      (event) => {
        if (event.type === "text") {
          acc += event.text;
          setStatusLabel(null);
          setStreamingText(acc);
        } else if (event.type === "tool_start") {
          setStatusLabel(`Checking ${event.label}…`);
        } else if (event.type === "error") {
          setError(event.error);
        }
      },
      controller.signal,
    )
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setMessages((prev) => (acc ? [...prev, { role: "assistant", content: acc }] : prev));
        setStreamingText(null);
        setStatusLabel(null);
      });
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg"
        aria-label="Ask about your restaurant"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col p-0 sm:max-w-md">
          <SheetHeader className="border-b px-5 py-4 text-left">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <SheetTitle className="font-display text-lg">Ask about your restaurant</SheetTitle>
            </div>
            <SheetDescription>
              Grounded in your real data — food cost, labor, vendors, inventory, price trends.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="flex-1 px-5 py-4">
            {messages.length === 0 && streamingText == null ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">Try asking:</p>
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => submit(p)}
                    className="block w-full rounded-lg border bg-muted/30 px-3 py-2 text-left text-sm hover:bg-muted/60"
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {m.role === "assistant" ? (
                        <MessageContent content={m.content} onNavigate={() => setOpen(false)} />
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}
                {streamingText != null && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-muted px-3.5 py-2 text-sm text-foreground">
                      {statusLabel && !streamingText ? (
                        <span className="text-muted-foreground">{statusLabel}</span>
                      ) : (
                        <MessageContent content={streamingText} onNavigate={() => setOpen(false)} />
                      )}
                    </div>
                  </div>
                )}
                {error && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl bg-destructive/10 px-3.5 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={scrollBottomRef} />
          </ScrollArea>

          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit(draft);
                  }
                }}
                placeholder="Ask a question…"
                rows={1}
                className="min-h-9 resize-none"
              />
              <Button
                size="icon"
                onClick={() => submit(draft)}
                disabled={streamingText != null || !draft.trim()}
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
