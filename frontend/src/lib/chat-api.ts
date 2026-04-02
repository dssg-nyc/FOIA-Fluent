const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  page: string;
  request_id?: string;
  draft_data?: Record<string, unknown>;
}

export interface ChatEvent {
  type: "text" | "tool_call" | "done";
  content?: string;
  name?: string;
  status?: string;
}

export async function* streamChat(
  messages: ChatMessage[],
  context: ChatContext,
  authToken?: string
): AsyncGenerator<ChatEvent> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_URL}/api/v1/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages, context }),
  });

  if (!response.ok) {
    yield { type: "text", content: "Sorry, I couldn't connect to the assistant. Please try again." };
    yield { type: "done" };
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    yield { type: "done" };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event: ChatEvent = JSON.parse(line.slice(6));
          yield event;
        } catch {
          // Skip malformed lines
        }
      }
    }
  }
}
