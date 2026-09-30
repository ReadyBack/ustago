import { ProviderGate } from '../../src/components/ProviderGate';
import { ConversationList } from '../../src/features/chat/ConversationList';

export default function ProviderMessages() {
  return (
    <ProviderGate>
      <ConversationList role="PROVIDER" />
    </ProviderGate>
  );
}
