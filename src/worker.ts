import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DATA_KEY_GRAPH, type GraphIssue, type GraphPayload } from "./shared.js";

const PAGE = 500;
const MAX_ISSUES = 5000;

type IssueRow = {
  id: string;
  identifier?: string | null;
  title?: string | null;
  status?: string | null;
  priority?: string | null;
  projectId?: string | null;
  parentId?: string | null;
  assigneeAgentId?: string | null;
  updatedAt?: string | Date | null;
};

async function listAllIssues(ctx: PluginContext, companyId: string) {
  const rows: IssueRow[] = [];
  for (let offset = 0; offset < MAX_ISSUES; offset += PAGE) {
    const page = (await ctx.issues.list({ companyId, limit: PAGE, offset })) as unknown as IssueRow[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

const RELATIONS_TTL_MS = 60_000;
const relationsCache = new Map<string, { at: number; ids: string[] }>();

// The list endpoint does not carry blocker relations, so read them per open issue
// (a few at a time) and cache them briefly; closed issues keep no live blockers.
async function readBlockers(ctx: PluginContext, companyId: string, rows: IssueRow[]) {
  const result = new Map<string, string[]>();
  const pending = rows.filter((row) => {
    if (row.status === "done" || row.status === "cancelled") return false;
    const cached = relationsCache.get(row.id);
    if (cached && Date.now() - cached.at < RELATIONS_TTL_MS) {
      result.set(row.id, cached.ids);
      return false;
    }
    return true;
  });
  let next = 0;
  const worker = async () => {
    while (next < pending.length) {
      const row = pending[next++];
      try {
        const summary = await ctx.issues.relations.get(row.id, companyId);
        const ids = summary.blockedBy.map((b) => b.id);
        relationsCache.set(row.id, { at: Date.now(), ids });
        result.set(row.id, ids);
      } catch {
        result.set(row.id, []);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return result;
}

function toIso(value: string | Date | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register(DATA_KEY_GRAPH, async (params) => {
      const companyId = typeof params?.companyId === "string" ? params.companyId : "";
      if (!companyId) throw new Error("companyId is required");

      const [company, projects, agents, issueResult] = await Promise.all([
        ctx.companies.get(companyId).catch(() => null),
        ctx.projects.list({ companyId, limit: 1000 }),
        ctx.agents.list({ companyId, limit: 500 }),
        listAllIssues(ctx, companyId)
      ]);

      const blockers = await readBlockers(ctx, companyId, issueResult.rows);
      const issues: GraphIssue[] = issueResult.rows.map((row) => ({
        id: row.id,
        identifier: row.identifier ?? null,
        title: row.title ?? "(sem título)",
        status: row.status ?? "todo",
        priority: row.priority ?? null,
        projectId: row.projectId ?? null,
        parentId: row.parentId ?? null,
        assigneeAgentId: row.assigneeAgentId ?? null,
        blockedByIds: blockers.get(row.id) ?? [],
        updatedAt: toIso(row.updatedAt)
      }));

      const payload: GraphPayload = {
        companyName: (company as { name?: string } | null)?.name ?? "Empresa",
        projects: projects.map((p) => ({
          id: p.id,
          name: p.name,
          color: (p as { color?: string | null }).color ?? null
        })),
        issues,
        agents: agents.map((a) => ({ id: a.id, name: a.name })),
        truncated: issueResult.truncated,
        generatedAt: new Date().toISOString()
      };
      return payload;
    });
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
