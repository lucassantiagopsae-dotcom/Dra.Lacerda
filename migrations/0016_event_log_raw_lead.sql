-- Guarda nome e telefone crus do lead, ao lado do raw_email que ja existia.
--
-- Motivo: nesta instancia a conversao NAO passa por checkout de plataforma de
-- vendas — o lead preenche um formulario e vai para o WhatsApp. Sem estas duas
-- colunas o D1 registra que houve um Lead e de qual campanha ele veio, mas nao
-- guarda com quem falar. O PII cru fica no D1 da propria cliente; para a Meta
-- continua indo apenas o SHA-256.
ALTER TABLE event_log ADD COLUMN raw_name TEXT DEFAULT '';
ALTER TABLE event_log ADD COLUMN raw_phone TEXT DEFAULT '';
