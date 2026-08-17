import { useMutation } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase/client";
import { useRestaurantIds } from "@/lib/supabase/scope";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

// Client keeps the whole conversation in memory and resends it every
// turn — the chat edge function is stateless, no server-side history
// in v1 (see supabase/functions/chat/index.ts).
export function useSendChatMessage() {
  const restaurantId = useRestaurantIds()[0];

  return useMutation({
    mutationFn: async (messages: ChatMessage[]): Promise<string> => {
      if (!restaurantId) throw new Error("No restaurant selected");
      const { data, error } = await supabase.functions.invoke("chat", {
        body: { restaurant_id: restaurantId, messages },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Chat request failed");
      return data.reply as string;
    },
  });
}
