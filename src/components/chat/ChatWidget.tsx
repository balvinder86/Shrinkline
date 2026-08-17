import { useEffect, useRef, useState } from "react";
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
import { useSendChatMessage, type ChatMessage } from "@/lib/chat/queries";
import { cn } from "@/lib/utils";

const EXAMPLE_PROMPTS = [
  "What's my food cost variance this month?",
  "Which vendor am I spending the most with?",
  "Any ingredients with a big price jump lately?",
  "How's my labor cost doing this week?",
];

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = useSendChatMessage();
  const scrollBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, send.isPending]);

  function submit(text: string) {
    const content = text.trim();
    if (!content || send.isPending) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    send.mutate(next, {
      onSuccess: (reply) => setMessages((prev) => [...prev, { role: "assistant", content: reply }]),
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
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
            {messages.length === 0 ? (
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
                      {m.content}
                    </div>
                  </div>
                ))}
                {send.isPending && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl bg-muted px-3.5 py-2 text-sm text-muted-foreground">
                      Thinking…
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
                disabled={send.isPending || !draft.trim()}
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
