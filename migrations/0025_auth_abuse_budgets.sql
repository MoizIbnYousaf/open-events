-- Privacy-preserving, immutable reservations for exact mail and auth budgets.
-- Keys are HMACs derived with an environment-specific secret; raw email,
-- address, token, and session values never enter either table.
CREATE TABLE mail_budget_events (
  operation_id TEXT PRIMARY KEY,
  recipient_key TEXT NOT NULL,
  environment_key TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (length(created_at) = 24)
);

CREATE INDEX idx_mail_budget_recipient_time
  ON mail_budget_events (recipient_key, created_at);
CREATE INDEX idx_mail_budget_environment_time
  ON mail_budget_events (environment_key, created_at);

CREATE TABLE auth_limit_events (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (
    scope IN (
      'start_recipient_attempt',
      'start_source',
      'admin_login_failure',
      'redeem_source',
      'redeem_token',
      'organizer_send_event'
    )
  ),
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL CHECK (length(created_at) = 24)
);

CREATE INDEX idx_auth_limit_scope_key_time
  ON auth_limit_events (scope, key_hash, created_at);
