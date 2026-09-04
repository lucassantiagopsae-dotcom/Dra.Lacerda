-- Log de cada tentativa de envio de lead para um CRM externo.
--
-- Sem isto uma falha do CRM seria invisivel: o lead ja seguiu para o WhatsApp
-- e ninguem perceberia que ele nao entrou no funil. Guarda o payload enviado e
-- a resposta crua para dar para depurar sem reproduzir o lead.
CREATE TABLE IF NOT EXISTS crm_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT,
    session_id TEXT,
    provider TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status_code INTEGER DEFAULT 0,
    ok INTEGER DEFAULT 0,
    person_id TEXT,
    deal_id TEXT,
    request_payload TEXT,
    response_body TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_log_created ON crm_log(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_log_event ON crm_log(event_id);
