import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { FriendsList } from "@/components/chat/FriendsList";
import { ChatView } from "@/components/chat/ChatView";

type ActivePane = "global" | "announcements" | "dm" | "list";

export default function ChatLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!loading && !user) navigate("/auth");
  }, [user, loading, navigate]);

  // Lock body scroll while inside the chat shell so only the message list scrolls.
  useEffect(() => {
    document.body.classList.add("chat-locked");
    return () => document.body.classList.remove("chat-locked");
  }, []);

  const path = location.pathname;
  const conversationId = searchParams.get("c");

  const active: ActivePane = path.startsWith("/global-chat")
    ? "global"
    : path.startsWith("/announcements")
    ? "announcements"
    : conversationId
    ? "dm"
    : "list";

  // Persist last selected DM so ChatView stays mounted when toggling between channels
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    conversationId,
  );
  useEffect(() => {
    if (conversationId && conversationId !== activeConversationId) {
      setActiveConversationId(conversationId);
    }
  }, [conversationId, activeConversationId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const removedConvId = detail.conversationId as string | null | undefined;
      if (removedConvId && removedConvId === activeConversationId) {
        setActiveConversationId(null);
        if (path === "/chat") {
          setSearchParams({}, { replace: true });
        } else {
          navigate("/chat");
        }
      }
    };
    window.addEventListener("friend-removed", handler);
    return () => window.removeEventListener("friend-removed", handler);
  }, [activeConversationId, path, navigate, setSearchParams]);

  const handleSelectConversation = (id: string) => {
    if (path !== "/chat") {
      navigate(`/chat?c=${id}`);
    } else {
      setSearchParams({ c: id }, { replace: true });
    }
  };

  const handleBack = () => {
    if (path === "/chat") {
      setSearchParams({}, { replace: true });
    } else {
      navigate("/chat");
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const channelPanes = (
    <>
      <div className={`h-full ${active === "global" ? "block" : "hidden"}`}>
        <ChatView
          channel="global"
          isActive={active === "global"}
          isMobile={isMobile}
          onBack={isMobile ? handleBack : undefined}
        />
      </div>
      <div className={`h-full ${active === "announcements" ? "block" : "hidden"}`}>
        <ChatView
          channel="announcements"
          isActive={active === "announcements"}
          isMobile={isMobile}
          onBack={isMobile ? handleBack : undefined}
        />
      </div>
      {activeConversationId && (
        <div className={`h-full ${active === "dm" ? "block" : "hidden"}`}>
          <ChatView
            key={activeConversationId}
            conversationId={activeConversationId}
            isActive={active === "dm"}
            isMobile={isMobile}
            onBack={isMobile ? handleBack : undefined}
          />
        </div>
      )}
    </>
  );

  if (isMobile) {
    return (
      <div className="h-[100dvh]">
        <div className={active === "list" ? "h-full" : "hidden"}>
          <FriendsList
            onSelectConversation={handleSelectConversation}
            selectedConversationId={active === "dm" ? activeConversationId : null}
          />
        </div>
        <div className={active !== "list" ? "h-full" : "hidden"}>
          {channelPanes}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] gap-3 p-3 bg-background">
      <div className="w-80 flex-shrink-0 float-panel overflow-hidden">
        <FriendsList
          onSelectConversation={handleSelectConversation}
          selectedConversationId={active === "dm" ? activeConversationId : null}
        />
      </div>
      <div className="flex-1 min-w-0 relative float-panel overflow-hidden">
        {active === "list" && (
          <div className="flex h-full items-center justify-center">
            <p className="text-lg text-muted-foreground">
              Select a conversation to start chatting
            </p>
          </div>
        )}
        {channelPanes}
      </div>
    </div>
  );
}
