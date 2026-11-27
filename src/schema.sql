CREATE TABLE IF NOT EXISTS links (
  code varchar(7) PRIMARY KEY,
  destination text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  clicks bigint NOT NULL DEFAULT 0,
  last_clicked_at timestamptz
);
