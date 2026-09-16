-- Codigo curto que liga um clique no WhatsApp a visita que o originou.
--
-- Motivo: os CTAs passaram a abrir o WhatsApp direto, sem formulario. O mapa
-- de calor mostrava gente clicando no botao e abandonando o formulario. Sem
-- formulario nao ha nome nem telefone — nada que identifique a pessoa quando
-- ela aparece no Agendor semanas depois, e o retorno de etapas do CRM para a
-- Meta perderia o elo com o anuncio.
--
-- O elo passa a ser um codigo (ex.: VL-7K3QM) que vai na mensagem pre-escrita
-- do WhatsApp. A equipe copia o codigo para o negocio no Agendor; quando a
-- etapa muda, o webhook acha o codigo no payload, busca aqui a sessao e
-- devolve o evento a Meta com o fbc daquele clique.
CREATE TABLE IF NOT EXISTS wa_refs (
    ref TEXT PRIMARY KEY,
    session_id TEXT,
    event_id TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_refs_session ON wa_refs(session_id);
