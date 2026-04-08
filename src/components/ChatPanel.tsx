import { useEffect, useRef, useState } from "react";
import { ChatMessage, RoomMember, RoomRole } from "../types";

type Props = {
  messages: ChatMessage[];
  members: RoomMember[];
  currentUserId: string;
  currentRole: RoomRole;
  onSend: (body: string) => void;
  onPromote: (userId: string) => void;
  isSending: boolean;
};

export function ChatPanel({ messages, members, currentUserId, currentRole, onSend, onPromote, isSending }: Props) {
  const [tab, setTab] = useState<"chat" | "members">("chat");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setDraft("");
  }

  return (
    <div className="chat-panel">
      <div className="chat-tabs">
        <button className={tab === "chat" ? "chat-tab active" : "chat-tab"} onClick={() => setTab("chat")}>
          Chat
          {messages.length > 0 && <span className="chat-badge">{messages.length > 99 ? "99+" : messages.length}</span>}
        </button>
        <button className={tab === "members" ? "chat-tab active" : "chat-tab"} onClick={() => setTab("members")}>
          Members <span className="chat-badge">{members.length}</span>
        </button>
      </div>

      {tab === "chat" && (
        <>
          <div className="chat-messages">
            {messages.length === 0 && (
              <p className="chat-empty">No messages yet. Say hi 👋</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-msg ${msg.userId === currentUserId ? "chat-msg--own" : ""}`}>
                {msg.userId !== currentUserId && (
                  <span className="chat-msg__name">{msg.displayName}</span>
                )}
                <span className="chat-msg__bubble">{msg.body}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="chat-input-row">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, 500))}
              placeholder="Say something…"
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              disabled={isSending}
            />
            <button className="chat-send-btn" onClick={handleSend} disabled={!draft.trim() || isSending}>
              ↑
            </button>
          </div>
        </>
      )}

      {tab === "members" && (
        <div className="members-list">
          {members.map((m) => (
            <div key={m.userId} className="member-row">
              <div className="member-row__info">
                <span className="member-row__name">{m.displayName}{m.userId === currentUserId ? " (you)" : ""}</span>
                <span className={`member-row__role ${m.role === "host" ? "member-row__role--host" : ""}`}>{m.role}</span>
              </div>
              {currentRole === "host" && m.role !== "host" && m.userId !== currentUserId && (
                <button className="promote-btn" onClick={() => onPromote(m.userId)}>
                  Make host
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
