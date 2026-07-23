import { createOrganization, listOrganizations, getPortfolioReport, addOrgUser, bulkImportPortfolio } from "../../../../lib/enterprise/organizations";

export async function GET(req) {
  const orgId = new URL(req.url).searchParams.get("report");
  try {
    if (orgId) return Response.json({ ok: true, ...(await getPortfolioReport(orgId)) });
    return Response.json({ ok: true, organizations: await listOrganizations() });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (body.action === "addUser") return Response.json({ ok: true, user: await addOrgUser(body.orgId, body) });
    if (body.action === "importPortfolio") return Response.json({ ok: true, ...(await bulkImportPortfolio(body.orgId, body.properties)) });
    const org = await createOrganization(body);
    return Response.json({ ok: true, organization: org });
  } catch (e) {
    return Response.json({ ok: false, error: e.message }, { status: 400 });
  }
}
