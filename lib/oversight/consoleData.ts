const REALITIES = ["REAL_NOW", "CACHED_REAL"];
const EVIDENCE_TYPES = ["IMAGERY", "PERMIT", "WEATHER", "STRUCTURE", "PROPERTY"];
const PROFILE_LIMIT = 500;
const PARCEL_BATCH_SIZE = 100;
const PAGE_SIZE = 1000;

type QueryResult = { data: any[]; error: any | null };

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function loadEvidenceBatch(db: any, parcelIds: string[]): Promise<QueryResult> {
  const data: any[] = [];
  let from = 0;

  while (true) {
    const page = await db
      .from("evidence_records")
      .select("*")
      .in("parcel_id", parcelIds)
      .in("type", EVIDENCE_TYPES)
      .in("reality", REALITIES)
      .order("captured_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (page.error) return { data, error: page.error };
    const rows = page.data || [];
    data.push(...rows);
    if (rows.length < PAGE_SIZE) return { data, error: null };
    from += PAGE_SIZE;
  }
}

function imageUrl(row: any): string | null {
  if (row?.type !== "IMAGERY" || !row?.payload?.storage_path || !row?.parcel_id) return null;
  const version = String(row.content_hash || row.captured_at || "current").slice(0, 16);
  return `/api/oversight/image/${encodeURIComponent(String(row.parcel_id))}?v=${encodeURIComponent(version)}`;
}

function isUsableEvidence(row: any): boolean {
  const payload = row?.payload;
  if (!payload || payload.reason || payload.error) return false;

  if (row.type === "IMAGERY") return Boolean(payload.storage_path);
  if (row.type === "STRUCTURE") {
    return Boolean(
      payload.address ||
      payload.latitude != null ||
      payload.longitude != null ||
      payload.year_built ||
      payload.yearBuilt ||
      payload.effective_year_built ||
      payload.property_type ||
      payload.dwelling_type
    );
  }
  if (row.type === "PROPERTY") {
    return Boolean(payload.matched_address || payload.address || payload.zip || payload.latitude != null || payload.longitude != null);
  }
  if (row.type === "PERMIT") {
    return Boolean(
      payload.id ||
      payload.number ||
      payload.issue_date ||
      payload.description ||
      payload.search_result ||
      Array.isArray(payload.records)
    );
  }
  if (row.type === "WEATHER") {
    return Object.keys(payload).some(key => key !== "reason" && key !== "error");
  }
  return Object.keys(payload).length > 0;
}

export async function loadOversightConsoleData(db: any) {
  const [profilesResult, ringsResult, eligibleResult] = await Promise.all([
    db
      .from("roof_profiles")
      .select("*", { count: "exact" })
      .order("live_rank", { ascending: true, nullsFirst: false })
      .order("rank_score", { ascending: false })
      .limit(PROFILE_LIMIT),
    db.from("ring_status").select("*").order("ring_id"),
    db.from("roof_profiles").select("parcel_id", { count: "exact", head: true }).eq("leaderboard_eligible", true),
  ]);

  const profiles: any[] = profilesResult.data || [];
  const parcelIds: string[] = profiles.map((profile: any) => String(profile.parcel_id || "")).filter(Boolean);
  const batchResults = await Promise.all(chunks(parcelIds, PARCEL_BATCH_SIZE).map(batch => loadEvidenceBatch(db, batch)));
  const evidenceErrors = batchResults.map(result => result.error).filter(Boolean);

  // Queries are newest-first. Keep the newest usable record of each evidence
  // type for each property. A later crawler marker such as
  // { reason: "provider_not_configured" } must never hide a real assessor
  // record, permit, or privately stored image that was already collected.
  const latest = new Map<string, any>();
  for (const row of batchResults.flatMap(result => result.data)) {
    const key = `${row.parcel_id}:${row.type}`;
    const current = latest.get(key);
    if (!current || (!isUsableEvidence(current) && isUsableEvidence(row))) latest.set(key, row);
  }

  const evidence = [...latest.values()]
    .sort((left, right) => String(right.captured_at || "").localeCompare(String(left.captured_at || "")))
    .map(row => {
      const url = imageUrl(row);
      return url ? { ...row, payload: { ...row.payload, image_url: url } } : row;
    });

  const parcelsWithPhotos = new Set(
    evidence
      .filter(row => row.type === "IMAGERY" && row.payload?.storage_path)
      .map(row => row.parcel_id)
  );
  const top100 = profiles.filter((profile: any, index: number) => {
    const rank = Number(profile.live_rank);
    return rank > 0 ? rank <= 100 : index < 100;
  });
  const error = profilesResult.error || ringsResult.error || eligibleResult.error || evidenceErrors[0] || null;

  return {
    profiles,
    totalProfiles: profilesResult.count ?? profiles.length,
    eligibleCount: eligibleResult.count ?? profiles.filter((profile: any) => profile.leaderboard_eligible).length,
    evidence,
    rings: ringsResult.data || [],
    photoCount: parcelsWithPhotos.size,
    photoCoverage: {
      top100Photos: top100.filter((profile: any) => parcelsWithPhotos.has(profile.parcel_id)).length,
      top100Total: top100.length,
      top500Photos: profiles.filter((profile: any) => parcelsWithPhotos.has(profile.parcel_id)).length,
      top500Total: profiles.length,
    },
    connectionError: error?.message || null,
  };
}
