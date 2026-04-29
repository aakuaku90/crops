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
  /**
   * Optional one-shot prompt to auto-send the moment the panel opens with
   * this value. Used by callers that want to launch a specific question
   * (e.g. "what's the current maize price?"). Each distinct string fires at
   * most once — the panel tracks the last-fired value internally, so passing
   * the same prompt repeatedly doesn't re-trigger.
   */
  initialPrompt?: string | null;
  onClose: () => void;
}

/**
 * Right-side chat panel that talks to Claude with web search enabled.
 * Slides in when a crop is clicked on the Signals page; the conversation
 * stays scoped to that crop until the user closes the panel or selects a
 * different one (which resets the thread).
 */
// Local UI variant that lets us pin the step trail onto each assistant
// reply. ChatMessage (the API shape) only carries role+content; we map down
// to that when sending to the backend.
interface UIMessage extends ChatMessage {
  steps?: ChatStep[];
}

export function ChatPanel({ open, crop, region = null, initialPrompt = null, onClose }: Props) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Steps the assistant is taking *for the current in-flight turn*: starts
  // with "Thinking", then each tool invocation (with its row count once the
  // result returns) is appended below. Only the most recent step animates;
  // earlier steps freeze as a record. Cleared when the final answer commits.
  const [steps, setSteps] = useState<ChatStep[]>([]);
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
  // Tracks the last `initialPrompt` we auto-sent so the same prompt doesn't
  // re-fire when the panel reopens or React re-runs the effect. Resets when
  // the scope (crop/region) changes — same lifecycle as the messages list.
  const lastFiredPromptRef = useRef<string | null>(null);
  // Ref to the active (most recent) Q&A group. When the user sends a new
  // message, we scroll this group's top to the top of the scroll viewport.
  const activeGroupRef = useRef<HTMLDivElement>(null);
  // Measured height of the scroll container, used to give the active group
  // a viewport-tall min-height. CSS percentage chains break when an
  // intermediate ancestor's height is auto/min-h, so we measure directly
  // and update on resize. Without this, total content == viewport height
  // and scrollIntoView has nothing to scroll.
  const [scrollAreaHeight, setScrollAreaHeight] = useState(0);

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
    // Allow the same initialPrompt to re-fire after a scope change.
    lastFiredPromptRef.current = null;
  }, [crop, region]);

  // Auto-send `initialPrompt` once when the panel opens (or when the prompt
  // changes to a new value while open). Guards: panel must be open, panel
  // must have a crop, and we haven't already fired this exact prompt.
  useEffect(() => {
    if (!open || !crop || !initialPrompt) return;
    if (lastFiredPromptRef.current === initialPrompt) return;
    lastFiredPromptRef.current = initialPrompt;
    // Schedule a microtask so we don't kick off a fetch during render.
    queueMicrotask(() => handleSend(initialPrompt));
    // handleSend is intentionally omitted from deps — it closes over fresh
    // state on every render, so referencing it would re-fire on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, crop, region, initialPrompt]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // When the user sends a new message, scroll the new (active) Q&A group's
  // top to the top of the scroll viewport. The group has a JS-measured
  // min-height equal to the scroll container's clientHeight, so total
  // content always exceeds viewport — that's what makes scrollIntoView do
  // anything. We deliberately do NOT scroll on streaming text deltas or
  // when the assistant's reply commits, so the user reads at their own
  // pace without the view jumping.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last?.role !== "user") return;
    // Defer one frame so the new group has been added to the DOM and its
    // ref is populated before we measure / scroll.
    requestAnimationFrame(() => {
      activeGroupRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [messages]);

  // Measure the scroll container's height once it mounts, and re-measure
  // on resize. The measured value drives the active group's `min-height`
  // (set inline below) so we always have viewport-worth of content for
  // scrollIntoView to traverse.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setScrollAreaHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

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

  async function handleSend(override?: string) {
    const text = (override ?? input).trim();
    if (!text || loading || !crop) return;

    const userMsg: UIMessage = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setStreamingText("");
    setLoading(true);
    setError(null);
    setSteps([{ kind: "thinking", label: "Thinking", active: true }]);

    const controller = new AbortController();
    abortRef.current = controller;
    let assembled = "";
    // Local mirror of the steps state — used to capture the final snapshot
    // that gets pinned onto the committed message. Mirroring here avoids
    // closing over a stale `steps` value at commit time.
    let finalSteps: ChatStep[] = [{ kind: "thinking", label: "Thinking", active: true }];
    try {
      // Backend ChatMessage is just {role, content} — strip UI-only fields.
      const apiMessages: ChatMessage[] = next.map((m) => ({ role: m.role, content: m.content }));
      await streamChat(
        crop,
        apiMessages,
        (delta) => {
          assembled += delta;
          setStreamingText(assembled);
          finalSteps = finalSteps.map((s) => ({ ...s, active: false }));
          setSteps(finalSteps);
        },
        controller.signal,
        {
          webSearch,
          region,
          onTool: (evt) => {
            if (evt.type === "tool_call") {
              // Freeze prior steps; push a new active step for this tool.
              finalSteps = [
                ...finalSteps.map((s) => ({ ...s, active: false })),
                { kind: "tool", name: evt.name, label: toolLabel(evt.name), active: true },
              ];
              setSteps(finalSteps);
            } else if (evt.type === "tool_result") {
              // Annotate the most recent step with the row count; keep it
              // active until the next tool_call or first text delta.
              finalSteps = finalSteps.map((s, i) =>
                i === finalSteps.length - 1
                  ? { ...s, count: evt.count, label: toolResultLabel(evt.name, evt.count) }
                  : s,
              );
              setSteps(finalSteps);
            }
          },
          onRetry: (evt) => {
            // Surface transient retries (overloaded / rate-limited) as a
            // step, so the user sees "Anthropic is busy — retrying in 8s…"
            // instead of a hard error.
            const label =
              evt.reason === "overloaded"
                ? `Anthropic is busy — retrying in ${evt.after_seconds}s`
                : evt.reason === "rate_limit"
                ? `Rate limit hit — retrying in ${evt.after_seconds}s`
                : `Connection issue — retrying in ${evt.after_seconds}s`;
            finalSteps = [
              ...finalSteps.map((s) => ({ ...s, active: false })),
              { kind: "thinking", label, active: true },
            ];
            setSteps(finalSteps);
          },
        },
      );
      // Commit the streamed text into the messages list once done, pinning
      // the (now-frozen) step trail onto the assistant message so it
      // remains visible above its bubble in the conversation history.
      const frozen = finalSteps.map((s) => ({ ...s, active: false }));
      setMessages([
        ...next,
        { role: "assistant", content: assembled, steps: frozen },
      ]);
      setStreamingText("");
      setSteps([]);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message ?? "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  // Walk the message list and pair each user message with its assistant
  // reply (if any) into a discrete group. The trailing group also picks up
  // the in-flight `streamingText` and `steps` so the active turn renders
  // inside the same container as the user message that triggered it. Only
  // the last group is marked `isActive` and gets `min-h-full` to pin its
  // top to the scroll viewport.
  const groups = (() => {
    type Group = {
      user: UIMessage;
      assistant: UIMessage | null;
      streaming?: string;
      liveSteps?: ChatStep[];
    };
    const out: Group[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        out.push({ user: m, assistant: null });
      } else if (m.role === "assistant" && out.length > 0) {
        out[out.length - 1].assistant = m;
      }
    }
    // Attach in-flight bits to the trailing group (the user message that
    // triggered the current request, awaiting its reply).
    if (out.length > 0 && (loading || streamingText)) {
      const trailing = out[out.length - 1];
      if (!trailing.assistant) {
        trailing.streaming = streamingText;
        trailing.liveSteps = steps;
      }
    }
    return out;
  })();

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

      {/* Message thread — Q&A groups, not a flat list. The active (most
          recent) group has min-h-full so the user's question always pins
          to the top of the scroll viewport when it arrives. Older groups
          shrink to content. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streamingText ? (
          <div className="px-5 py-4 space-y-3">
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
        ) : (
          // Wrapper just stacks groups; the active group's min-height is
          // set from JS (scrollAreaHeight) so total content always exceeds
          // the viewport — that's the precondition for scrollIntoView to
          // actually scroll. Subtract 32px so the group fills the viewport
          // exactly accounting for the wrapper's vertical padding.
          <div className="px-5 py-4 flex flex-col">
            {groups.map((g, i) => {
              const isActive = i === groups.length - 1;
              const trail = g.liveSteps ?? g.assistant?.steps;
              return (
                <div
                  key={i}
                  ref={isActive ? activeGroupRef : null}
                  style={
                    isActive && scrollAreaHeight > 0
                      ? { minHeight: `${scrollAreaHeight - 32}px` }
                      : undefined
                  }
                  className={`flex flex-col gap-3 ${
                    i > 0 ? "pt-6 mt-6 border-t border-border/60" : ""
                  }`}
                >
                  <Bubble role="user">{g.user.content}</Bubble>
                  {trail && trail.length > 0 && <StepTrail steps={trail} />}
                  {g.assistant ? (
                    <Bubble role="assistant">{g.assistant.content}</Bubble>
                  ) : g.streaming ? (
                    <Bubble role="assistant" streaming>{g.streaming}</Bubble>
                  ) : null}
                </div>
              );
            })}
            {error && (
              <div className="mt-4 text-xs text-danger bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
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

function StepTrail({ steps }: { steps: ChatStep[] }) {
  // A single continuous rail running through the icon centers. Each icon
  // sits ON the rail, with `bg-card` and a higher z-index so it visually
  // punches through the line at its position. Position math: outer pl-1
  // (4px) + LogoMark half-width (7px) → icon center at x=11px. Soft
  // `bg-foreground/15` rounded-full caps so the line reads as a quiet
  // thread, not a hard rule.
  if (steps.length === 0) return null;
  const showRail = steps.length > 1;
  return (
    <div className="relative pl-1">
      {showRail && (
        <span
          className="pointer-events-none absolute left-[11px] top-2.5 bottom-2.5 w-px bg-foreground/15 rounded-full"
          aria-hidden
        />
      )}
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div
            key={i}
            className="relative flex items-start gap-3 text-xs text-muted-foreground"
          >
            <LogoMark
              className={`relative z-10 w-3.5 h-3.5 text-foreground shrink-0 mt-0.5 bg-card ${
                s.active ? "animate-logo-pulse" : "opacity-40"
              }`}
            />
            <span className={`leading-snug ${s.active ? "text-foreground" : "opacity-70"}`}>
              {s.label}
              {s.active ? "…" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// One step in the assistant's reasoning trail.
interface ChatStep {
  kind: "thinking" | "tool";
  /** Tool internal name when kind === 'tool'. Used only for keying. */
  name?: string;
  /** Display label — e.g. "Looking up FAO Food Balance". The trailing
   *  ellipsis is added in the render path based on `active`. */
  label: string;
  /** Row count once the tool result returns. */
  count?: number;
  /** True only for the most-recent step; false for completed prior steps. */
  active: boolean;
}

// Tool-name → human label. Maps internal names ("query_food_balance") to
// readable status text ("Looking up FAO Food Balance"). Falls back to the
// raw name for any tool we haven't given a friendly label.
const TOOL_LABELS: Record<string, string> = {
  query_food_prices: "Looking up WFP food prices",
  query_food_balance: "Looking up FAO Food Balance",
  query_predictions: "Looking up model predictions",
  query_producer_prices: "Looking up FAO producer prices",
  query_population: "Looking up Ghana population",
  web_search: "Searching the web",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? `Running ${name}`;
}

function toolResultLabel(name: string, count?: number): string {
  const base = TOOL_LABELS[name] ?? name;
  if (count == null) return `${base} — done`;
  return `${base} — ${count} ${count === 1 ? "row" : "rows"}`;
}

function Bubble({
  role,
  streaming = false,
  children,
}: {
  role: "user" | "assistant";
  /** When true, the assistant logomark animates (response is mid-stream).
   *  When false, the logomark sits static — a quiet provenance mark on
   *  every completed AI reply. */
  streaming?: boolean;
  children: string;
}) {
  // Both roles span the full panel width — role distinction comes from the
  // background color and the asymmetric corner. User bubbles tighten the
  // bottom-right; assistant bubbles tighten the bottom-left. Assistant
  // bubbles also carry an inline logomark at the bottom-left as a persistent
  // "this came from CROPS AI" mark.
  if (role === "user") {
    return (
      <div className="w-full rounded-2xl rounded-br-sm bg-foreground text-background px-3 py-2 text-sm whitespace-pre-wrap">
        {children}
      </div>
    );
  }
  return (
    <div className="w-full rounded-2xl rounded-bl-sm bg-muted text-foreground px-4 py-3 text-sm leading-relaxed">
      <MarkdownContent>{children}</MarkdownContent>
      <div className="mt-2 pt-2 border-t border-border/60">
        <LogoMark
          className={`w-4 h-4 text-foreground/60 ${streaming ? "animate-logo-pulse" : ""}`}
        />
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
