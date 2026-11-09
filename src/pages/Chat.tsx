import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FriendsList } from "@/components/chat/FriendsList";
import { ChatView } from "@/components/chat/ChatView";
import { useIsMobile } from "@/hooks/use-mobile";

export default function Chat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    searchParams.get("c")
  );
  const isMobile = useIsMobile();

  useEffect(() => {
    const c = searchParams.get("c");
    if (c && c !== selectedConversationId) setSelectedConversationId(c);
  }, [searchParams]);

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversationId(conversationId);
    setSearchParams({ c: conversationId }, { replace: true });
  };

  const handleBack = () => {
    setSelectedConversationId(null);
    setSearchParams({}, { replace: true });
  };

  if (isMobile) {
    if (selectedConversationId) {
      return (
        <div className="h-[100dvh]">
          <ChatView 
            conversationId={selectedConversationId} 
            onBack={handleBack}
            isMobile={true}
          />
        </div>
      );
    }
    return (
      <div className="h-[100dvh]">
        <FriendsList
          onSelectConversation={handleSelectConversation}
          selectedConversationId={selectedConversationId}
        />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <div className="w-80 border-r border-border">
        <FriendsList
          onSelectConversation={handleSelectConversation}
          selectedConversationId={selectedConversationId}
        />
      </div>
      <ChatView 
        conversationId={selectedConversationId} 
        isMobile={false}
      />
    </div>
  );
}
