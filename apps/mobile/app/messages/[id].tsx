import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '../../src/features/chat/ChatScreen';

/** /messages/:id — also the target of message.* notifications. */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatScreen conversationId={id} />;
}
