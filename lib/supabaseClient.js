// Direct browser database access is disabled. The clean recovery project has
// zero anon/authenticated table grants by design; durable operations go
// through owner-authenticated /api routes and browser-only tools retain their
// existing localStorage fallback.
const supabase = null;

export default supabase;
