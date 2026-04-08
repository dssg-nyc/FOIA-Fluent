"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { usePathname } from "next/navigation";
import { streamChat, ChatMessage, ChatContext } from "@/lib/chat-api";
import { getAccessToken } from "@/lib/supabase";

interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  toolStatus?: string;
}

function getPageContext(pathname: string): ChatContext {
  if (pathname.startsWith("/draft")) return { page: "draft" };
  if (pathname.startsWith("/requests/")) {
    const id = pathname.split("/requests/")[1]?.split("/")[0];
    return { page: "request_detail", request_id: id };
  }
  if (pathname.startsWith("/hub/insights")) return { page: "insights" };
  if (pathname.startsWith("/hub/states")) return { page: "states" };
  if (pathname.startsWith("/hub")) return { page: "hub" };
  if (pathname.startsWith("/dashboard")) return { page: "dashboard" };
  return { page: "general" };
}

export default function ChatPanel() {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth > 768;
    }
    return true;
  });
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [toolStatus, setToolStatus] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolStatus]);

  // Focus input when opened
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keyboard shortcut: Cmd+K to toggle
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg: DisplayMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);
    setThinking(true);
    setToolStatus("");

    // Get auth token if available
    let authToken: string | undefined;
    try {
      const token = await getAccessToken();
      if (token) authToken = token;
    } catch {}

    // Build message history for API
    const apiMessages: ChatMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const context = getPageContext(pathname);

    let fullText = "";
    let assistantAdded = false;

    try {
      for await (const event of streamChat(apiMessages, context, authToken)) {
        if (event.type === "text" && event.content) {
          setThinking(false);
          fullText = event.content;
          if (!assistantAdded) {
            setMessages((prev) => [...prev, { role: "assistant", content: fullText }]);
            assistantAdded = true;
          } else {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === "assistant") {
                last.content = fullText;
              }
              return [...updated];
            });
          }
          setToolStatus("");
        } else if (event.type === "tool_call") {
          const labels: Record<string, string> = {
            lookup_exemption: "Looking up exemption...",
            lookup_agency: "Looking up agency...",
            search_web: "Searching trusted sources...",
            search_web_broad: "Researching deeper...",
            search_requests: "Checking your requests...",
            get_hub_stats: "Querying Transparency Hub...",
            search_muckrock: "Searching MuckRock...",
          };
          if (event.status === "running") {
            setToolStatus(labels[event.name || ""] || "Working...");
          } else {
            setToolStatus("");
          }
        } else if (event.type === "done") {
          break;
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === "assistant" && !last.content) {
          last.content = "Sorry, something went wrong. Please try again.";
        }
        return [...updated];
      });
    }

    setStreaming(false);
    setThinking(false);
    setToolStatus("");
  }, [input, streaming, messages, pathname]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function renderMarkdown(text: string) {
    // Separate source lines from body text
    const sourceRegex = /(?:^|\n)Source[s]?:\s*(.+?)$/gim;
    const sources: string[] = [];
    let body = text.replace(sourceRegex, (_m, src) => { sources.push(src.trim()); return ""; });

    // Also capture [source: ...] inline refs
    body = body.replace(/\[source:\s*([^\]]+)\]/g, (_m, src) => { sources.push(src.trim()); return ""; });

    let html = body
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
;

    // Wrap <li> runs in <ul>
    html = html.replace(/((?:<li>.*?<\/li>\s*)+)/g, "<ul>$1</ul>");

    // Split into paragraphs
    html = html
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        if (p.startsWith("<ul>") || p.startsWith("<div")) return p;
        return `<p>${p}</p>`;
      })
      .join("");

    // Split single newlines within paragraphs
    html = html.replace(/<p>([^<]*)\n([^<]*)<\/p>/g, "<p>$1</p><p>$2</p>");

    // Append source chips at the end
    if (sources.length > 0) {
      const chips = sources.map((src) => {
        // Make statute refs link to Cornell Law
        if (src.match(/U\.S\.C\./)) {
          return `<a href="https://www.law.cornell.edu/uscode/text/5/552" target="_blank" rel="noopener noreferrer" class="chat-source-chip">${src}</a>`;
        }
        if (src.match(/^https?:\/\//)) {
          const domain = src.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
          return `<a href="${src}" target="_blank" rel="noopener noreferrer" class="chat-source-chip">${domain}</a>`;
        }
        return `<span class="chat-source-chip">${src}</span>`;
      }).join("");
      html += `<div class="chat-source-row">${chips}</div>`;
    }

    return html;
  }

  return (
    <>
      {/* Minimized bubble */}
      {!open && (
        <button
          className="chat-bubble"
          onClick={() => setOpen(true)}
          title="FOIA Research Assistant (Cmd+K)"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      )}

      {/* Mobile backdrop — tap to close */}
      {open && <div className="chat-backdrop" onClick={() => setOpen(false)} />}

      {/* Open panel */}
      {open && (
        <div className="chat-panel">
          {/* Header */}
          <div className="chat-header">
            <div className="chat-header-left">
              <span className="chat-header-title">FOIA Assistant</span>
              <span className="chat-header-badge">AI</span>
            </div>
            <div className="chat-header-actions">
              <button
                className="chat-header-btn"
                onClick={() => setMessages([])}
                title="Clear chat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-7 5v6m4-6v6M5 6l1 14h12l1-14" /></svg>
              </button>
              <button
                className="chat-header-btn"
                onClick={() => setOpen(false)}
                title="Close (Esc)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-welcome">
                <p className="chat-welcome-title">Hi! I&apos;m your FOIA research assistant.</p>
                <p className="chat-welcome-sub">I can help with FOIA research, data discovery, drafting requests, and managing agency communications.</p>
                <div className="chat-suggestions">
                  {[
                    "Help me file a FOIA request",
                    "What happens after I submit my request?",
                    "How do I appeal a denial?",
                    "What is Exemption 5?",
                  ].map((q) => (
                    <button
                      key={q}
                      className="chat-suggestion"
                      onClick={() => {
                        setInput(q);
                        setTimeout(() => {
                          setInput(q);
                          sendMessage();
                        }, 50);
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`chat-msg chat-msg-${msg.role}`}
              >
                {msg.role === "assistant" ? (
                  <div
                    className="chat-msg-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content || (streaming && i === messages.length - 1 ? "..." : "")) }}
                  />
                ) : (
                  <div className="chat-msg-content">{msg.content}</div>
                )}
              </div>
            ))}

            {thinking && !toolStatus && (
              <div className="chat-thinking">
                <div className="chat-thinking-dots">
                  <span /><span /><span />
                </div>
                <span>Thinking...</span>
              </div>
            )}

            {toolStatus && (
              <div className="chat-tool-status">
                <div className="chat-tool-indicator">
                  <div className="chat-tool-pulse" />
                  <div className="chat-tool-info">
                    <span className="chat-tool-label">{toolStatus}</span>
                    <span className="chat-tool-sub">Checking verified sources</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="chat-input-area">
            <input
              ref={inputRef}
              className="chat-input"
              type="text"
              placeholder="Ask about FOIA..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
            />
            <button
              className="chat-send"
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </>
  );
}
