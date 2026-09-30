import { Screen } from '../../src/components/Screen';
import { EmptyState } from '../../src/components/States';

/** Messaging comes in a later phase; until then this is an honest empty state. */
export default function Messages() {
  return (
    <Screen scroll={false}>
      <EmptyState
        icon="💬"
        title="Henüz mesajınız yok"
        body="Mesajlaşma yakında açılacak. Şimdilik teklifleri ve pazarlığı Taleplerim bölümünden takip edebilirsiniz; anlaştığınız ustanın telefonu iş detayında görünür."
      />
    </Screen>
  );
}
