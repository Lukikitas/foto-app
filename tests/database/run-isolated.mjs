import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const db = new PGlite();
const files = ['tests/database/bootstrap.sql','supabase/migrations/20260927090000_reviewed_complaint_imports.sql','supabase/migrations/20260927090000_reviewed_complaint_imports.sql','supabase/migrations/20261008090000_photo_cleanup_settings.sql','supabase/migrations/20261008090000_photo_cleanup_settings.sql','supabase/migrations/20261011090000_storage_usage.sql','supabase/migrations/20261011090000_storage_usage.sql','tests/database/reviewed-imports.sql','tests/database/storage-usage.sql'];
try {for(const file of files){await db.exec(await readFile(file,'utf8'));console.log('OK '+file);} } finally {await db.close();}
