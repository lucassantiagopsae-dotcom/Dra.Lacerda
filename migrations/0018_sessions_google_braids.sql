-- Apply before publishing the middleware that writes these columns.
-- Preserve Google click identifiers across later visits without query parameters.
ALTER TABLE sessions ADD COLUMN gbraid TEXT;
ALTER TABLE sessions ADD COLUMN wbraid TEXT;
