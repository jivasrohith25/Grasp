import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "http://localhost:8000";

const defaultSession = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `session-${Date.now()}`;

const themeStyles = {
  dark: {
    "--bg": "#0f0f0f",
    "--surface": "#1a1a1a",
    "--border": "#2a2a2a",
    "--text": "#f3f3f3",
    "--muted": "#b3b3b3",
  },
  light: {
    "--bg": "#f9f9f9",
    "--surface": "#ffffff",
    "--border": "#e5e5e5",
    "--text": "#1a1a1a",
    "--muted": "#6b6b6b",
  },
};

export default function App() {
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(defaultSession());
  const [collectionId, setCollectionId] = useState("grasp-default");
  const [suggestions, setSuggestions] = useState([]);
  const [theme, setTheme] = useState("dark");
  const [ingestStatus, setIngestStatus] = useState("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [sessions, setSessions] = useState([sessionId]);

  const fileRef = useRef(null);
  const chatRef = useRef(null);

  const themeVars = useMemo(() => themeStyles[theme], [theme]);

  useEffect(() => {
    if (!sessions.includes(sessionId)) {
      setSessions((prev) => [sessionId, ...prev]);
    }
  }, [sessionId, sessions]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  const resetSession = () => {
    const next = defaultSession();
    setSessionId(next);
    setMessages([]);
  };

  const ingestFile = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("collection_id", collectionId);

    setIngestStatus("processing");
    try {
      const res = await fetch(`${API_BASE}/ingest/file`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error("ingest failed");
      }
      setIngestStatus("done");
      await loadSuggestions();
    } catch (err) {
      setIngestStatus("error");
    }
  };

  const ingestUrl = async () => {
    if (!urlInput.trim()) {
      return;
    }

    const body = new URLSearchParams();
    body.set("url", urlInput.trim());
    body.set("collection_id", collectionId);

    setIngestStatus("processing");
    try {
      const res = await fetch(`${API_BASE}/ingest/url`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        throw new Error("ingest failed");
      }
      setIngestStatus("done");
      await loadSuggestions();
    } catch (err) {
      setIngestStatus("error");
    }
  };

  const loadSuggestions = async () => {
    const body = new URLSearchParams();
    body.set("collection_id", collectionId);
    const res = await fetch(`${API_BASE}/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    setSuggestions(data.suggestions || []);
  };

  const sendMessage = async (messageOverride) => {
    const message = (messageOverride ?? inputMessage).trim();
    if (!message || isStreaming) {
      return;
    }

    setInputMessage("");
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: message }]);

    const body = new URLSearchParams();
    body.set("message", message);
    body.set("collection_id", collectionId);
    body.set("session_id", sessionId);

    try {
      const res = await fetch(`${API_BASE}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const sourcesHeader = res.headers.get("x-sources") || "";
      const sources = sourcesHeader
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "", sources }]);

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          assistantText += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const updated = [...prev];
            const lastIndex = updated.length - 1;
            if (updated[lastIndex]?.role === "assistant") {
              updated[lastIndex] = {
                ...updated[lastIndex],
                content: assistantText,
              };
            }
            return updated;
          });
        }
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: "error" }]);
    } finally {
      setIsStreaming(false);
    }
  };

  const summarize = async () => {
    if (isStreaming) {
      return;
    }

    const body = new URLSearchParams();
    body.set("collection_id", collectionId);

    const res = await fetch(`${API_BASE}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      return;
    }

    const data = await res.json();
    if (data.summary) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.summary, sources: [] },
      ]);
    }
  };

  const ingestIndicator = () => {
    if (ingestStatus === "processing") {
      return (
        <span className="text-xs text-[var(--muted)] flex items-center gap-2">
          processing
          <span className="dot-ellipsis" aria-hidden="true" />
        </span>
      );
    }
    if (ingestStatus === "done") {
      return <span className="text-xs text-[var(--muted)]">done</span>;
    }
    if (ingestStatus === "error") {
      return <span className="text-xs text-[var(--muted)]">error</span>;
    }
    return <span className="text-xs text-[var(--muted)]">idle</span>;
  };

  return (
    <div
      className="min-h-screen text-sm transition-all duration-200"
      style={{
        background: themeVars["--bg"],
        color: themeVars["--text"],
        ...themeVars,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <style>{`
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap");
        .dot-ellipsis {
          width: 18px;
          display: inline-block;
          position: relative;
        }
        .dot-ellipsis::after {
          content: "...";
          position: absolute;
          animation: dots 1.2s steps(3, end) infinite;
        }
        @keyframes dots {
          0% { clip-path: inset(0 100% 0 0); }
          50% { clip-path: inset(0 30% 0 0); }
          100% { clip-path: inset(0 0 0 0); }
        }
        .blink {
          animation: blink 1s steps(2, start) infinite;
        }
        @keyframes blink {
          0% { opacity: 1; }
          50% { opacity: 0; }
          100% { opacity: 1; }
        }
      `}</style>

      <div className="flex min-h-screen">
        <aside
          className="flex flex-col w-[260px] border-r"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="px-5 py-4 border-b" style={{ borderColor: "var(--border)" }}>
            <div className="text-base font-semibold" style={{ color: "#6c63ff" }}>
              Grasp
            </div>
          </div>

          <div className="px-5 py-4 space-y-4">
            <button
              className="w-full text-sm font-medium border rounded-lg px-3 py-2 transition-all"
              style={{ borderColor: "var(--border)", background: "transparent" }}
              onClick={resetSession}
            >
              new session
            </button>

            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                upload
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.json,.docx,.md,.csv"
                className="w-full text-xs rounded-lg border px-3 py-2"
                style={{ background: "transparent", borderColor: "var(--border)" }}
              />
              <button
                className="w-full text-sm font-medium rounded-lg px-3 py-2"
                style={{ background: "#6c63ff", color: "white" }}
                onClick={ingestFile}
              >
                ingest file
              </button>
            </div>

            <div className="space-y-2">
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://"
                className="w-full text-xs rounded-lg border px-3 py-2"
                style={{ background: "transparent", borderColor: "var(--border)" }}
              />
              <button
                className="w-full text-sm font-medium rounded-lg px-3 py-2"
                style={{ background: "#6c63ff", color: "white" }}
                onClick={ingestUrl}
              >
                ingest url
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-[var(--muted)]">collection id</label>
              <input
                value={collectionId}
                onChange={(event) => setCollectionId(event.target.value)}
                className="w-full text-xs rounded-lg border px-3 py-2 font-mono"
                style={{ background: "transparent", borderColor: "var(--border)" }}
              />
            </div>

            <div className="text-xs text-[var(--muted)]">ingest status: {ingestIndicator()}</div>
          </div>

          <div className="px-5 py-4 border-t" style={{ borderColor: "var(--border)" }}>
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              sessions
            </div>
            <div className="mt-3 space-y-2 max-h-40 overflow-auto pr-1">
              {sessions.map((id) => (
                <button
                  key={id}
                  className={`w-full text-left text-xs rounded-lg px-2 py-1 border font-mono ${
                    id === sessionId ? "text-white" : "text-[var(--muted)]"
                  }`}
                  style={{
                    borderColor: "var(--border)",
                    background: id === sessionId ? "#6c63ff" : "transparent",
                  }}
                  onClick={() => setSessionId(id)}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-auto px-5 py-4 border-t" style={{ borderColor: "var(--border)" }}>
            <button
              className="w-full text-sm font-medium border rounded-lg px-3 py-2 transition-all"
              style={{ borderColor: "var(--border)" }}
              onClick={toggleTheme}
            >
              {theme === "dark" ? "switch to light" : "switch to dark"}
            </button>
          </div>
        </aside>

        <main className="flex-1 flex flex-col">
          <div
            className="flex items-center justify-between px-6 py-4 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="text-xs text-[var(--muted)]">
              collection: <span className="font-mono">{collectionId}</span> | session:{" "}
              <span className="font-mono">{sessionId}</span>
            </div>
            <button
              className="text-xs border rounded-lg px-3 py-2"
              style={{ borderColor: "var(--border)" }}
              onClick={toggleTheme}
            >
              {theme === "dark" ? "light mode" : "dark mode"}
            </button>
          </div>

          <div
            ref={chatRef}
            className="flex-1 overflow-auto px-6 py-6 space-y-4"
          >
            {messages.length === 0 && (
              <div className="h-full flex items-center justify-center text-xs text-[var(--muted)]">
                Upload a document to get started
              </div>
            )}

            {messages.map((msg, index) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={`${msg.role}-${index}`}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[70%] border rounded-lg px-4 py-3 text-sm leading-relaxed ${
                      isUser ? "text-white" : "text-[var(--text)]"
                    }`}
                    style={{
                      background: isUser ? "#6c63ff" : "var(--surface)",
                      borderColor: "var(--border)",
                    }}
                  >
                    <div>{msg.content}</div>
                    {!isUser && msg.sources && msg.sources.length > 0 && (
                      <div className="mt-2 text-xs text-[var(--muted)]">
                        sources: {msg.sources.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isStreaming && (
              <div className="flex justify-start">
                <div
                  className="max-w-[70%] border rounded-lg px-4 py-3 text-sm"
                  style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                >
                  typing <span className="blink">_</span>
                </div>
              </div>
            )}
          </div>

          {suggestions.length > 0 && (
            <div
              className="px-6 py-3 border-t flex flex-wrap gap-2"
              style={{ borderColor: "var(--border)" }}
            >
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="text-xs border rounded-lg px-3 py-2"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => setInputMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          <div
            className="px-6 py-4 border-t flex items-center gap-3"
            style={{ borderColor: "var(--border)" }}
          >
            <input
              value={inputMessage}
              onChange={(event) => setInputMessage(event.target.value)}
              placeholder="ask a question"
              className="flex-1 rounded-lg border px-4 py-2 text-sm"
              style={{ background: "transparent", borderColor: "var(--border)" }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  sendMessage();
                }
              }}
            />
            <button
              className="text-sm font-medium rounded-lg px-4 py-2"
              style={{ background: "#6c63ff", color: "white" }}
              onClick={() => sendMessage()}
            >
              send
            </button>
            <button
              className="text-sm font-medium rounded-lg px-4 py-2 border"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              onClick={summarize}
            >
              summarize
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
