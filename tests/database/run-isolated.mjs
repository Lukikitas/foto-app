import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
const db = new PGlite();
const files = ['tests/database/bootstrap.sql','supabase/migrations/20260927090000_reviewed_complaint_imports.sql','supabase/migrations/20260927090000_reviewed_complaint_imports.sql','supabase/migrations/20261008090000_photo_cleanup_settings.sql','supabase/migrations/20261008090000_photo_cleanup_settings.sql','supabase/migrations/20261011090000_storage_usage.sql','supabase/migrations/20261011090000_storage_usage.sql','tests/database/reviewed-imports.sql','tests/database/storage-usage.sql'];
files.push('supabase/migrations/20261023090000_performance_reads.sql','supabase/migrations/20261023090000_performance_reads.sql','tests/database/performance-reads.sql','tests/database/storage-summary.sql');
files.push('supabase/migrations/20261023091000_photo_thumbnails.sql','supabase/migrations/20261023091000_photo_thumbnails.sql','supabase/migrations/20261023135000_thumbnail_job_permissions.sql','supabase/migrations/20261023135000_thumbnail_job_permissions.sql','tests/database/photo-thumbnails.sql');
files.push('supabase/migrations/20261029090000_capture_registration.sql','supabase/migrations/20261029090000_capture_registration.sql','tests/database/capture-registration.sql');
files.push('supabase/migrations/20261029220000_capture_path_guard.sql','supabase/migrations/20261029220000_capture_path_guard.sql','tests/database/capture-path-guard.sql');
try {for(const file of files){try { await db.exec(await readFile(file,'utf8'));console.log('OK '+file); } catch(error) { console.error(file+': '+error.message+' (position '+error.position+')'); process.exitCode=1; break; }} } finally {await db.close();}
