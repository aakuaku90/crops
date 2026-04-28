"use client";

import { useEffect, useRef, useState } from "react";
import { Send, X, Globe } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, type ChatMessage } from "@/lib/api";
import { LogoMark } from "./LogoMark";

const WEB_SEARCH_KEY = "crops:chat:webSearch";

interface Props {
  open: boolean;
  crop: string | null;
  /**
   * Optional Ghana region (e.g. "Ashanti"). When set, the chat is scoped to
   * that region — surfaced in the context bar and sent to the backend so the
   * system prompt can narrow its focus. Switching regions resets the thread.
   */
  region?: string | null;
  onClose: () => void;
}

/**
 * Right-side chat panel that talks to Claude with web search enabled.
 * Slides in when a crop is clicked on the Signals page; the conversation
 * stays scoped to that crop until the user closes the panel or selects a
 * different one (which resets the thread).
 */
export function ChatPanel({ open, crop, region = null, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Default to true; the real value is hydrated from localStorage in an
  // effect below so SSR and the first client render agree.
  const [webSearch, setWebSearch] = useState(true);
  // Hide the context bar (crop + web-search toggle) when scrolling down,
  // show again when scrolling up. Mirrors the page header's behaviour.
  const [contextVisible, setContextVisible] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollY = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Hydrate the toggle from localStorage on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(WEB_SEARCH_KEY);
    if (stored === "false") setWebSearch(false);
    else if (stored === "true") setWebSearch(true);
  }, []);

  // Persist the toggle every time it changes.
  useEffect(() => {
    window.localStorage.setItem(WEB_SEARCH_KEY, String(webSearch));
  }, [webSearch]);

  // Reset the thread whenever the user switches to a different crop OR
  // region. Each scope change starts a fresh conversation so prior turns
  // don't pull the assistant back to the previous crop/region.
  useEffect(() => {
    setMessages([]);
    setStreamingText("");
    setError(null);
    abortRef.current?.abort();
  }, [crop, region]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auto-scroll to the bottom on new messages or streaming text.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-grow the composer textarea to fit its content up to the CSS
  // max-height. Reset to "auto" first so deleting text shrinks the box back
  // down — without that, scrollHeight stays pinned at the previous tall value.
  // The browser caps growth at the inline max-height (8rem) and starts an
  // internal scrollbar past that.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  // Track scroll direction inside the message area so the context bar can
  // collapse on scroll-down and reveal on scroll-up.
  //
  // Two flicker sources need handling:
  //   1. AI streaming auto-scrolls each delta → ignored while `loading`.
  //   2. The bar's collapse animation reflows the scroll container,
  //      and trackpad inertia produces tiny back-and-forth deltas that
  //      would re-trigger toggling. Solved by:
  //      a) larger thresholds (hide needs +24px, show needs −40px), and
  //      b) a short lockout window after each change so rapid scrolls
  //         can't bounce the bar between states.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let lastChangeAt = 0;
    const LOCKOUT_MS = 250;
    const HIDE_DELTA = 24;
    const SHOW_DELTA = 40;

    const onScroll = () => {
      if (loading) {
        lastScrollY.current = el.scrollTop;
        return;
      }
      const now = Date.now();
      if (now - lastChangeAt < LOCKOUT_MS) {
        // Recent toggle — refresh baseline but don't re-toggle yet.
        lastScrollY.current = el.scrollTop;
        return;
      }
      const y = el.scrollTop;
      if (y < 8) {
        if (!contextVisible) {
          setContextVisible(true);
          lastChangeAt = now;
        }
      } else if (y > lastScrollY.current + HIDE_DELTA) {
        if (contextVisible) {
          setContextVisible(false);
          lastChangeAt = now;
        }
      } else if (y < lastScrollY.current - SHOW_DELTA) {
        if (!contextVisible) {
          setContextVisible(true);
          lastChangeAt = now;
        }
      }
      lastScrollY.current = y;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [loading, contextVisible]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading || !crop) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreamingText("");
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    let assembled = "";
    try {
      await streamChat(
        crop,
        next,
        (delta) => {
          assembled += delta;
          setStreamingText(assembled);
        },
        controller.signal,
        { webSearch, region },
      );
      // Commit the streamed text into the messages list once done.
      setMessages([...next, { role: "assistant", content: assembled }]);
      setStreamingText("");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message ?? "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  const scope = region ? `${crop} in ${region}` : crop;
  const suggestions = crop
    ? region
      ? [
          `What's the production outlook for ${crop} in ${region}?`,
          `How do prices in ${region} compare to other Ghana regions?`,
          `What climate or policy risks affect ${crop} in ${region}?`,
        ]
      : [
          `What's the current production outlook for ${crop} in Ghana?`,
          `Any recent price spikes for ${crop}?`,
          `Which regions are leading ${crop} production?`,
        ]
    : [];

  return (
    <aside
      className={`fixed top-2 right-2 bottom-2 z-50 w-full max-w-md bg-card border border-border rounded-xl shadow-[0_20px_60px_-10px_rgba(0,0,0,0.35)] overflow-hidden flex flex-col transform transition-transform duration-300 ease-out ${
        open ? "translate-x-0" : "translate-x-[calc(100%+0.5rem)] pointer-events-none"
      }`}
      aria-hidden={!open}
    >
      {/* Header — app logomark + close button. Crop context lives down by
          the composer where the user is actively typing. */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-foreground px-2 leading-none">
          <LogoMark className="w-5 h-5 text-foreground" />
          <span>CROPS</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Message thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && !streamingText && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Ask anything about <span className="font-medium text-foreground">{scope}</span>
              {region ? "" : " in Ghana"}: production, prices, trade, policy. Claude will search the
              web for current data when needed.
            </p>
            <div className="space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="block w-full text-left rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-muted/50 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <Bubble key={i} role={m.role}>{m.content}</Bubble>
        ))}

        {streamingText && <Bubble role="assistant">{streamingText}</Bubble>}

        {loading && !streamingText && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-foreground animate-pulse" />
            Searching the web…
          </div>
        )}

        {error && (
          <div className="text-xs text-danger bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>

      {/* Context bar — collapses on scroll-down, re-shows on scroll-up.
          Uses a max-height + opacity transition so the layout reflows
          smoothly rather than jumping. */}
      <div
        className={`border-t border-border overflow-hidden transition-all duration-200 ease-out ${
          contextVisible ? "max-h-12 opacity-100" : "max-h-0 opacity-0 border-t-0"
        }`}
        aria-hidden={!contextVisible}
      >
        <div className="px-4 py-2 flex items-center justify-between gap-3 text-[11px]">
          <span className="font-semibold text-foreground truncate">
            {crop ?? "—"}
            {region && (
              <span className="ml-1.5 font-normal text-muted-foreground">· {region}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setWebSearch((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
              webSearch
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
            }`}
            aria-pressed={webSearch}
            title={webSearch ? "Web search is on, click to disable" : "Web search is off, click to enable"}
          >
            <Globe className="w-3 h-3" />
            <span>Web search {webSearch ? "on" : "off"}</span>
          </button>
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-end gap-2 px-3 pt-3 pb-2"
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={crop ? `Ask about ${scope}…` : "Pick a crop first"}
            rows={1}
            disabled={!crop || loading}
            className="flex-1 resize-none overflow-y-auto rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10 disabled:opacity-60"
            style={{ minHeight: "2.5rem", maxHeight: "10rem" }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading || !crop}
            className="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-muted-foreground px-4 pb-3">
          Powered by Claude. Responses may include AI-generated content.
        </p>
      </div>
    </aside>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: string }) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-3 py-2 text-sm whitespace-pre-wrap">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-muted text-foreground px-4 py-3 text-sm leading-relaxed">
        <MarkdownContent>{children}</MarkdownContent>
      </div>
    </div>
  );
}

/**
 * Renders assistant text as Markdown with chat-tuned styles. Each element
 * type gets a tight spacing and size that fits inside a 360-450px bubble.
 * Links open in new tabs (web-search citations + general references).
 */
function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h2 className="text-base font-bold text-foreground mt-3 mb-1.5 first:mt-0">{children}</h2>
        ),
        h2: ({ children }) => (
          <h3 className="text-sm font-bold text-foreground mt-3 mb-1.5 first:mt-0 uppercase tracking-wider">
            {children}
          </h3>
        ),
        h3: ({ children }) => (
          <h4 className="text-sm font-semibold text-foreground mt-2.5 mb-1 first:mt-0">{children}</h4>
        ),
        h4: ({ children }) => (
          <h5 className="text-[13px] font-semibold text-foreground mt-2 mb-1 first:mt-0">{children}</h5>
        ),
        p: ({ children }) => (
          <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="my-1.5 ml-4 list-disc space-y-0.5 marker:text-muted-foreground">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="my-1.5 ml-4 list-decimal space-y-0.5 marker:text-muted-foreground">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className }) => {
          const isBlock = /language-/.test(className ?? "");
          if (isBlock) {
            return (
              <pre className="my-2 overflow-x-auto rounded-md bg-card border border-border p-2 text-[12px] font-mono text-foreground">
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code className="rounded bg-card border border-border px-1 py-0.5 text-[12px] font-mono text-foreground">
              {children}
            </code>
          );
        },
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground transition-colors"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-3 border-border" />,
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground italic">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full text-[12px] border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
        th: ({ children }) => (
          <th className="text-left font-semibold py-1.5 px-2 text-foreground">{children}</th>
        ),
        td: ({ children }) => <td className="py-1.5 px-2 border-t border-border">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
