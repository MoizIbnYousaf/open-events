-- Orby support desk. One conversation per (event, contact). Guest resume is a
-- hashed cookie, not a submitter session. Admin replies schedule a delayed
-- unread email (notify_after / notified_at); the Worker drains those on the
-- next support read rather than through a socket.
CREATE TABLE IF NOT EXISTS support_chats (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  last_message_at TEXT,
  admin_viewed_at TEXT,
  archived_at TEXT,
  guest_token_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (event_id, contact_id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE INDEX IF NOT EXISTS idx_support_chats_event_last
  ON support_chats(event_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_support_chats_event_archived
  ON support_chats(event_id, archived_at);
CREATE INDEX IF NOT EXISTS idx_support_chats_guest_token
  ON support_chats(guest_token_hash);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  content TEXT NOT NULL,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'admin')),
  read_at TEXT,
  notify_after TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES support_chats(id)
);

CREATE INDEX IF NOT EXISTS idx_support_messages_chat_created
  ON support_messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_due_notify
  ON support_messages(notify_after)
  WHERE notify_after IS NOT NULL AND notified_at IS NULL;
