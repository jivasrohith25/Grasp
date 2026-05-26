import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const API_BASE = "http://localhost:8000";

const createSessionId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `session-${Date.now()}`;

const themeTokens = {
  dark: {
    "--bg": "#0f0f0f",
    "--surface": "#1a1a1a",
    "--border": "#2a2a2a",
    "--text": "#f3f3f3",
    "--muted": "#b3b3b3",
    "--accent": "#6c63ff",
  },
  light: {
    "--bg": "#f9f9f9",
    "--surface": "#ffffff",
    "--border": "#e5e5e5",
    "--text": "#1a1a1a",
    "--muted": "#6b6b6b",
    "--accent": "#6c63ff",
  },
};

const SOURCE_TYPE_MODEL = "model";
const SOURCE_TYPE_DOCUMENT = "document";

export default function App() {
  const [screen, setScreen] = useState("landing");
  const [sourceType, setSourceType] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessionId, setSessionId] = useState(createSessionId());
  const [collectionId, setCollectionId] = useState("grasp-default");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [usedSuggestions, setUsedSuggestions] = useState([]);
  const [replacementLoading, setReplacementLoading] = useState(0);
  const [theme, setTheme] = useState("dark");
  const [ingestStatus, setIngestStatus] = useState("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [pastSessions, setPastSessions] = useState([]);
  const [viewingSessionId, setViewingSessionId] = useState(null);

  const fileRef = useRef(null);
  const chatRef = useRef(null);
  const ingestTokenRef = useRef(0);
  const ingestTimeoutRef = useRef(null);

  const themeVars = useMemo(() => themeTokens[theme], [theme]);

  const groupedPastSessions = useMemo(() => {
    const groups = {};
    for (const session of pastSessions) {
      const key = session.collection_id || collectionId || "unknown";
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(session);
    }
    return groups;
  }, [pastSessions, collectionId]);

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) {
      return "just now";
    }
    const diffSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
    if (diffSeconds < 60) {
      return "just now";
    }
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) {
      return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  useEffect(() => {
    if (screen !== "chat") {
      return;
    }

    const controller = new AbortController();
    const loadHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/history/${collectionId}`, {
          method: "GET",
          signal: controller.signal,
        });
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        if (Array.isArray(data.sessions)) {
          setPastSessions(data.sessions);
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }
      }
    };

    loadHistory();
    return () => controller.abort();
  }, [screen, collectionId]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  const resetAll = () => {
    setMessages([]);
    setSuggestions([]);
    setSuggestionsLoading(false);
    setUsedSuggestions([]);
    setReplacementLoading(0);
    setInputMessage("");
    setUrlInput("");
    setSelectedFile(null);
    setPastSessions([]);
    setViewingSessionId(null);
    if (ingestTimeoutRef.current) {
      clearTimeout(ingestTimeoutRef.current);
      ingestTimeoutRef.current = null;
    }
    setIngestStatus("idle");
    setSourceType(null);
    setSessionId(createSessionId());
    setScreen("landing");
  };

  const resetSession = () => {
    setMessages([]);
    setSuggestions([]);
    setSuggestionsLoading(false);
    setUsedSuggestions([]);
    setReplacementLoading(0);
    setInputMessage("");
    setCollectionId("grasp-default");
    setSourceType(null);
    setIngestStatus("idle");
    setPastSessions([]);
    setViewingSessionId(null);
    if (ingestTimeoutRef.current) {
      clearTimeout(ingestTimeoutRef.current);
      ingestTimeoutRef.current = null;
    }
    setSessionId(createSessionId());
    setScreen("landing");
  };

  const viewPastSession = (session) => {
    if (!session) {
      return;
    }
    setMessages(Array.isArray(session.messages) ? session.messages : []);
    setViewingSessionId(session.session_id);
  };

  const loadSuggestions = async (token) => {
    setSuggestionsLoading(true);
    setUsedSuggestions([]);
    setReplacementLoading(0);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    const body = new URLSearchParams();
    body.set("collection_id", collectionId);

    let res;
    try {
      res = await fetch(`${API_BASE}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      console.error("/suggest failed", error);
      clearTimeout(timeoutId);
      setSuggestions([]);
      setSuggestionsLoading(false);
      return false;
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.error("/suggest error", res.status);
      setSuggestions([]);
      setSuggestionsLoading(false);
      return false;
    }

    const data = await res.json();
    console.log("/suggest response", data);
    if (token !== ingestTokenRef.current) {
      setSuggestionsLoading(false);
      return false;
    }
    const next = Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
    setSuggestions(next);
    setSuggestionsLoading(false);
    return true;
  };

  const startIngest = () => {
    if (ingestTimeoutRef.current) {
      clearTimeout(ingestTimeoutRef.current);
      ingestTimeoutRef.current = null;
    }
    setIngestStatus("processing");
    setSuggestions([]);
    setSuggestionsLoading(false);
    setUsedSuggestions([]);
    setReplacementLoading(0);
    ingestTokenRef.current += 1;
    setScreen("chat");
    return ingestTokenRef.current;
  };

  const fetchReplacementSuggestion = async (excludeList) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const body = new URLSearchParams();
    body.set("collection_id", collectionId);
    body.set("exclude", excludeList.join(","));

    try {
      const res = await fetch(`${API_BASE}/suggest/single`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      if (!data?.suggestion) {
        return null;
      }
      return data.suggestion;
    } catch (error) {
      console.error("/suggest/single failed", error);
      clearTimeout(timeoutId);
      return null;
    }
  };

  const finishIngestSuccess = (token) => {
    if (token !== ingestTokenRef.current) {
      return;
    }
    setIngestStatus("ready");
    ingestTimeoutRef.current = setTimeout(() => {
      if (token === ingestTokenRef.current) {
        setIngestStatus("idle");
      }
    }, 3000);
  };

  const finishIngestError = (token) => {
    if (token !== ingestTokenRef.current) {
      return;
    }
    setIngestStatus("error");
  };

  const handleSuggestionClick = (suggestion, index) => {
    setInputMessage(suggestion);
    const nextUsed = [...usedSuggestions, suggestion];
    setUsedSuggestions(nextUsed);
    setSuggestions((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setReplacementLoading((prev) => prev + 1);
    fetchReplacementSuggestion(nextUsed).then((replacement) => {
      setReplacementLoading((prev) => Math.max(0, prev - 1));
      if (!replacement) {
        return;
      }
      setSuggestions((prev) => {
        if (prev.length >= 3) {
          return prev;
        }
        if (prev.includes(replacement)) {
          return prev;
        }
        return [...prev, replacement].slice(0, 3);
      });
    });
  };

  const ingestFile = async () => {
    const file = selectedFile || fileRef.current?.files?.[0];
    if (!file) {
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("collection_id", collectionId);

    const token = startIngest();
    try {
      const res = await fetch(`${API_BASE}/ingest/file`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error("ingest failed");
      }
      finishIngestSuccess(token);
      loadSuggestions(token);
    } catch (err) {
      finishIngestError(token);
    }
  };

  const ingestUrl = async () => {
    if (!urlInput.trim()) {
      return;
    }

    const body = new URLSearchParams();
    body.set("url", urlInput.trim());
    body.set("collection_id", collectionId);

    const token = startIngest();
    try {
      const res = await fetch(`${API_BASE}/ingest/url`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        throw new Error("ingest failed");
      }
      finishIngestSuccess(token);
      loadSuggestions(token);
    } catch (err) {
      finishIngestError(token);
    }
  };

  const sendMessage = async (overrideMessage) => {
    if (viewingSessionId) {
      return;
    }
    const message = (overrideMessage ?? inputMessage).trim();
    if (!message || isStreaming) {
      return;
    }

    setInputMessage("");
    setIsStreaming(true);
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setViewingSessionId(null);

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
      const sourceTypeHeader = res.headers.get("x-source-type") || "";
      const normalizedSourceType = sourceTypeHeader.toLowerCase();
      const sourceType =
        normalizedSourceType === SOURCE_TYPE_MODEL
          ? SOURCE_TYPE_MODEL
          : SOURCE_TYPE_DOCUMENT;
      const sources = sourcesHeader
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", sources, sourceType },
      ]);

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

      if (!viewingSessionId) {
        try {
          const historyRes = await fetch(`${API_BASE}/history/${collectionId}`);
          if (historyRes.ok) {
            const historyData = await historyRes.json();
            if (Array.isArray(historyData.sessions)) {
              setPastSessions(historyData.sessions);
            }
          }
        } catch (historyError) {
          // Ignore history refresh errors during streaming responses.
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "error", sourceType: SOURCE_TYPE_MODEL },
      ]);
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
        <span className="text-[12px] text-[var(--muted)] flex items-center gap-2">
          processing
          <span className="dot-ellipsis" aria-hidden="true" />
        </span>
      );
    }
    return <span className="text-[12px] text-[var(--muted)]">{ingestStatus}</span>;
  };

  const renderIngestBanner = () => {
    if (ingestStatus === "idle") {
      return null;
    }
    if (ingestStatus === "processing") {
      return (
        <div className="ingest-banner ingest-banner-processing">
          <span>Processing your document</span>
          <span className="dot-ellipsis" aria-hidden="true" />
        </div>
      );
    }
    if (ingestStatus === "ready") {
      return (
        <div className="ingest-banner ingest-banner-ready">Ready! Ask anything.</div>
      );
    }
    return (
      <div className="ingest-banner ingest-banner-error">
        <span>Ingestion failed. Try again.</span>
        <button
          className="text-[12px] rounded-lg px-3 py-2 btn btn-primary"
          onClick={resetAll}
        >
          New Document
        </button>
      </div>
    );
  };

  const handleDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const renderLanding = () => (
    <div className="flex min-h-screen flex-col">
      <div className="flex items-center justify-end px-8 py-6">
        <button className="text-[12px] rounded-lg px-3 py-2 btn" onClick={toggleTheme}>
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-4xl text-center">
          <div className="text-[28px] font-semibold" style={{ color: "var(--accent)" }}>
            Grasp
          </div>
          <div className="mt-2 text-[16px]">What would you like to explore today?</div>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div
              className="card flex flex-col items-center justify-center gap-3"
              role="button"
              tabIndex={0}
              onClick={() => {
                setSourceType("file");
                setScreen("upload");
                setSuggestions([]);
                setIngestStatus("idle");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSourceType("file");
                  setScreen("upload");
                  setSuggestions([]);
                  setIngestStatus("idle");
                }
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <path d="M8 3h6l4 4v14H8z" />
                <path d="M14 3v5h5" />
                <path d="M10 13h6" />
                <path d="M10 17h6" />
              </svg>
              <div className="text-[16px] font-semibold">Document</div>
              <div className="text-[12px] text-[var(--muted)]">PDF, TXT, JSON, DOCX</div>
            </div>
            <div
              className="card flex flex-col items-center justify-center gap-3"
              role="button"
              tabIndex={0}
              onClick={() => {
                setSourceType("url");
                setScreen("upload");
                setSuggestions([]);
                setIngestStatus("idle");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  setSourceType("url");
                  setScreen("upload");
                  setSuggestions([]);
                  setIngestStatus("idle");
                }
              }}
            >
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3c3.5 3.8 3.5 13.2 0 18" />
                <path d="M12 3c-3.5 3.8-3.5 13.2 0 18" />
              </svg>
              <div className="text-[16px] font-semibold">Website</div>
              <div className="text-[12px] text-[var(--muted)]">Paste any URL</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUpload = () => {
    const isFile = sourceType === "file";
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between px-8 py-6">
          <button className="text-[12px] rounded-lg px-3 py-2 btn" onClick={resetAll}>
            	
            <span className="inline-flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </span>
          </button>
          <button className="text-[12px] rounded-lg px-3 py-2 btn" onClick={toggleTheme}>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-2xl">
            <div className="text-[18px] font-semibold">
              {isFile ? "Upload Document" : "Enter Website URL"}
            </div>

            {isFile ? (
              <div
                className="drop-zone mt-6"
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.txt,.json,.docx"
                  className="hidden"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                />
                <div className="text-[12px] text-[var(--muted)]">
                  Drag & drop or click to upload
                </div>
                <div className="mt-2 text-[14px]">
                  {selectedFile ? selectedFile.name : "No file selected"}
                </div>
              </div>
            ) : (
              <input
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://"
                className="mt-6 w-full rounded-lg px-4 py-3 text-[14px] control"
              />
            )}

            <div className="mt-6">
              <label className="text-[12px] text-[var(--muted)]">Collection name</label>
              <input
                value={collectionId}
                onChange={(event) => setCollectionId(event.target.value)}
                className="mt-2 w-full rounded-lg px-4 py-3 text-[14px] font-mono control"
              />
            </div>

            <div className="mt-6">
              <button
                className="text-[14px] font-medium rounded-lg px-4 py-2 btn btn-primary"
                onClick={isFile ? ingestFile : ingestUrl}
              >
                {isFile ? "Ingest File" : "Fetch & Ingest"}
              </button>
              <div className="mt-3 text-[12px] text-[var(--muted)]">{ingestIndicator()}</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderChat = () => (
    <div className="flex min-h-screen">
      <aside
        className="flex flex-col w-[260px] border-r"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="px-6 py-5 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between">
            <div className="text-[16px] font-semibold" style={{ color: "var(--accent)" }}>
              Grasp
            </div>
            <span className="text-[12px] text-[var(--muted)]">v1</span>
          </div>
          <div className="mt-1 text-[12px] text-[var(--muted)]">RAG workspace</div>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="rounded-lg border px-4 py-4" style={{ borderColor: "var(--border)" }}>
            <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--muted)]">session</div>
            <div className="mt-3 text-[12px] text-[var(--muted)]">
              collection: <span className="font-mono">{collectionId}</span>
            </div>
            <div className="mt-2 text-[12px] text-[var(--muted)]">
              session: <span className="font-mono">{sessionId}</span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--muted)]">
              Past Chats
            </div>
            {pastSessions.length === 0 && (
              <div className="text-[12px] text-[var(--muted)]">No past sessions</div>
            )}
            {Object.entries(groupedPastSessions).map(([groupId, sessions]) => (
              <div key={groupId} className="space-y-2">
                {Object.keys(groupedPastSessions).length > 1 && (
                  <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    {groupId}
                  </div>
                )}
                {sessions.map((session) => {
                  const isViewing = session.session_id === viewingSessionId;
                  const count = Array.isArray(session.messages)
                    ? session.messages.length
                    : 0;
                  const timestamp = session.timestamp || 0;
                  const collectionName = session.collection_id || groupId || "unknown";
                  return (
                    <button
                      key={session.session_id}
                      className={`w-full text-left rounded-lg px-3 py-2 btn ${
                        isViewing ? "btn-primary" : "btn-muted"
                      }`}
                      onClick={() => viewPastSession(session)}
                    >
                      <div className="text-[12px] font-semibold">{collectionName}</div>
                      <div className="text-[11px] text-[var(--muted)]">
                        {count} message{count === 1 ? "" : "s"} · {formatRelativeTime(timestamp)}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto px-6 py-5 border-t" style={{ borderColor: "var(--border)" }}>
          <button className="w-full text-[14px] font-medium rounded-lg px-3 py-2 btn" onClick={toggleTheme}>
            {theme === "dark" ? "Switch to Light" : "Switch to Dark"}
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col">
        <div
          className="flex items-center justify-between px-8 py-5 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <button className="text-[12px] rounded-lg px-3 py-2 btn" onClick={resetSession}>
              Start Over
            </button>
            <div className="text-[12px] text-[var(--muted)]">
              collection: <span className="font-mono">{collectionId}</span> | session:{" "}
              <span className="font-mono">{sessionId}</span>
            </div>
            {viewingSessionId && (
              <div className="text-[12px] text-[var(--muted)]">Viewing past session</div>
            )}
          </div>
          <button className="text-[12px] rounded-lg px-3 py-2 btn" onClick={toggleTheme}>
            {theme === "dark" ? "Light Mode" : "Dark Mode"}
          </button>
        </div>
        {ingestStatus !== "idle" && (
          <div className="px-8 py-3 border-b" style={{ borderColor: "var(--border)" }}>
            {renderIngestBanner()}
          </div>
        )}

        <div ref={chatRef} className="flex-1 overflow-auto px-8 py-7 space-y-4">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-[12px] text-[var(--muted)]">
              Upload a document to get started
            </div>
          )}

          {messages.map((msg, index) => {
            const isUser = msg.role === "user";
            const isLastAssistant =
              !isUser && isStreaming && index === messages.length - 1;
            const isModelKnowledge = msg.sourceType === SOURCE_TYPE_MODEL;
            const isFromDocs = msg.sourceType === SOURCE_TYPE_DOCUMENT;
            const assistantBadge = () => {
              if (msg.role !== "assistant") {
                return null;
              }
              if (isModelKnowledge) {
                return <span className="badge badge-knowledge">⚠ Model Knowledge</span>;
              }
              if (isFromDocs) {
                return <span className="badge badge-docs">📄 From Documents</span>;
              }
              return null;
            };
            const cleanedContent = msg.content;

            return (
              <div
                key={`${msg.role}-${index}`}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[68%] border rounded-lg px-4 py-3 text-[14px] leading-relaxed ${
                    isUser ? "text-white" : "text-[var(--text)]"
                  }`}
                  style={{
                    background: isUser ? "var(--accent)" : "var(--surface)",
                    borderColor: "var(--border)",
                  }}
                >
                  {isUser ? (
                    <div>
                      {cleanedContent}
                      {isLastAssistant && <span className="blink">_</span>}
                    </div>
                  ) : (
                    <div>
                      <ReactMarkdown>{cleanedContent}</ReactMarkdown>
                      {isLastAssistant && <span className="blink">_</span>}
                    </div>
                  )}
                  {!isUser && <div className="mt-2">{assistantBadge()}</div>}
                  {!isUser && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 text-[12px] text-[var(--muted)]">
                      sources: {msg.sources.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {isStreaming && messages.length === 0 && (
            <div className="flex justify-start">
              <div
                className="max-w-[70%] border rounded-lg px-4 py-3 text-[14px]"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                typing <span className="blink">_</span>
              </div>
            </div>
          )}
        </div>

        {suggestionsLoading && (
          <div
            className="px-8 py-4 border-t flex flex-wrap items-center gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--muted)]">
              suggested
            </div>
            {[0, 1, 2].map((index) => (
              <div
                key={`placeholder-${index}`}
                className="text-[12px] rounded-lg px-3 py-2 btn btn-chip btn-ghost"
              >
                ...
              </div>
            ))}
          </div>
        )}

        {!suggestionsLoading && (suggestions.length > 0 || replacementLoading > 0) && (
          <div
            className="px-8 py-4 border-t flex flex-wrap items-center gap-2"
            style={{ borderColor: "var(--border)" }}
          >
            <div className="text-[12px] uppercase tracking-[0.2em] text-[var(--muted)]">
              suggested
            </div>
            {suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion}-${index}`}
                className="text-[12px] rounded-lg px-3 py-2 btn btn-chip"
                onClick={() => handleSuggestionClick(suggestion, index)}
              >
                {suggestion}
              </button>
            ))}
            {Array.from({
              length: Math.min(replacementLoading, Math.max(0, 3 - suggestions.length)),
            }).map((_, index) => (
              <div
                key={`replacement-${index}`}
                className="text-[12px] rounded-lg px-3 py-2 btn btn-chip btn-ghost"
              >
                ...
              </div>
            ))}
          </div>
        )}

        <div className="px-8 py-5 border-t flex items-center gap-3" style={{ borderColor: "var(--border)" }}>
          <input
            value={inputMessage}
            onChange={(event) => setInputMessage(event.target.value)}
            placeholder="Ask a question"
            className="flex-1 rounded-lg px-4 py-2 text-[14px] control"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                sendMessage();
              }
            }}
            disabled={Boolean(viewingSessionId)}
          />
          <button
            className="text-[14px] font-medium rounded-lg px-4 py-2 btn btn-primary"
            onClick={() => sendMessage()}
            disabled={Boolean(viewingSessionId)}
          >
            Send
          </button>
          <button
            className="text-[14px] font-medium rounded-lg px-4 py-2 btn btn-muted"
            onClick={summarize}
            disabled={Boolean(viewingSessionId)}
          >
            Summarize
          </button>
        </div>
      </main>
    </div>
  );

  return (
    <div
      className="min-h-screen text-[14px] transition-all duration-200"
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
        .control {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text);
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
        }
        .control:focus {
          outline: none;
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent);
        }
        .btn {
          border: 1px solid var(--border);
          background: transparent;
          color: var(--text);
          transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
        }
        .btn:hover {
          border-color: var(--accent);
        }
        .btn-primary {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
        }
        .btn-primary:hover {
          opacity: 0.92;
        }
        .btn-muted {
          color: var(--muted);
        }
        .btn-muted:hover {
          color: var(--text);
        }
        .btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .control:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        .btn-chip {
          background: transparent;
        }
        .btn-chip:hover {
          background: rgba(108, 99, 255, 0.08);
        }
        .btn-ghost {
          color: var(--muted);
          border-color: var(--border);
          background: rgba(127, 127, 127, 0.08);
          pointer-events: none;
          animation: pulse 1.6s ease-in-out infinite;
        }
        @keyframes pulse {
          0% {
            opacity: 0.45;
          }
          50% {
            opacity: 0.9;
          }
          100% {
            opacity: 0.45;
          }
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 12px;
          border: 1px solid transparent;
        }
        .badge-knowledge {
          color: #fbbf24;
          border-color: rgba(251, 191, 36, 0.35);
          background: rgba(251, 191, 36, 0.1);
        }
        .badge-docs {
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.35);
          background: rgba(34, 197, 94, 0.1);
        }
        .card {
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 32px 24px;
          background: var(--surface);
          transition: border-color 0.2s ease, transform 0.2s ease;
          cursor: pointer;
        }
        .card:hover {
          border-color: var(--accent);
          transform: translateY(-2px);
        }
        .drop-zone {
          border: 1px dashed var(--border);
          border-radius: 16px;
          padding: 40px 24px;
          background: var(--surface);
          text-align: center;
          cursor: pointer;
        }
        .ingest-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid var(--border);
          font-size: 13px;
          background: var(--surface);
        }
        .ingest-banner-processing {
          color: var(--text);
        }
        .ingest-banner-ready {
          color: #22c55e;
          border-color: rgba(34, 197, 94, 0.35);
          background: rgba(34, 197, 94, 0.08);
        }
        .ingest-banner-error {
          justify-content: space-between;
          color: #f87171;
          border-color: rgba(248, 113, 113, 0.45);
          background: rgba(248, 113, 113, 0.1);
        }
        ::selection {
          background: rgba(108, 99, 255, 0.25);
        }
      `}</style>

      {screen === "landing" && renderLanding()}
      {screen === "upload" && renderUpload()}
      {screen === "chat" && renderChat()}
    </div>
  );
}
