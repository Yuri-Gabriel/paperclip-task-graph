import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useHostNavigation, usePluginData, type PluginPageProps } from "@paperclipai/plugin-sdk/ui";
import { DATA_KEY_GRAPH, type GraphIssue, type GraphPayload } from "../shared.js";
import { ForceSim, type SimLink, type SimNode } from "./force.js";

const STATUS: Record<string, { label: string; color: string }> = {
  backlog: { label: "Backlog", color: "#8b8f98" },
  todo: { label: "A fazer", color: "#3b82f6" },
  in_progress: { label: "Em andamento", color: "#f59e0b" },
  in_review: { label: "Em revisão", color: "#a855f7" },
  blocked: { label: "Bloqueada", color: "#ef4444" },
  done: { label: "Concluída", color: "#22c55e" },
  cancelled: { label: "Cancelada", color: "#6b7280" }
};
const CLOSED = new Set(["done", "cancelled"]);
const PROJECT_COLOR = "#14b8a6";
const REFRESH_MS = 60_000;

function isDark() {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

interface Filters {
  projectId: string;
  agentId: string;
  showClosed: boolean;
  showBlocks: boolean;
}

interface BuiltGraph {
  nodes: SimNode[];
  links: SimLink[];
  issueById: Map<string, GraphIssue>;
}

function buildGraph(data: GraphPayload, filters: Filters, previous: Map<string, SimNode>, agentName: Map<string, string>): BuiltGraph {
  const issueById = new Map(data.issues.map((i) => [i.id, i]));
  const childCount = new Map<string, number>();
  for (const i of data.issues) if (i.parentId) childCount.set(i.parentId, (childCount.get(i.parentId) ?? 0) + 1);

  const matches = (i: GraphIssue) =>
    (filters.showClosed || !CLOSED.has(i.status)) &&
    (!filters.projectId || i.projectId === filters.projectId) &&
    (!filters.agentId || i.assigneeAgentId === filters.agentId);

  // Matching issues, plus their ancestors (dimmed) so every node stays attached to its tree.
  const visible = new Map<string, boolean>();
  for (const i of data.issues) {
    if (!matches(i)) continue;
    visible.set(i.id, false);
    let parent = i.parentId ? issueById.get(i.parentId) : undefined;
    while (parent && !visible.has(parent.id)) {
      visible.set(parent.id, !matches(parent));
      parent = parent.parentId ? issueById.get(parent.parentId) : undefined;
    }
  }

  const place = (id: string, near?: SimNode) => {
    const old = previous.get(id);
    if (old) return { x: old.x, y: old.y };
    const bx = near?.x ?? 0;
    const by = near?.y ?? 0;
    return { x: bx + (Math.random() - 0.5) * 80, y: by + (Math.random() - 0.5) * 80 };
  };

  const nodes: SimNode[] = [];
  const nodeById = new Map<string, SimNode>();
  const add = (n: Omit<SimNode, "x" | "y" | "vx" | "vy" | "fixed">, near?: SimNode) => {
    const pos = place(n.id, near);
    const node: SimNode = { ...n, ...pos, vx: 0, vy: 0, fixed: false };
    nodes.push(node);
    nodeById.set(node.id, node);
    return node;
  };

  const company = add({
    id: "company",
    kind: "company",
    label: data.companyName,
    sublabel: `${visible.size} tarefas`,
    status: null,
    color: isDark() ? "#e5e7eb" : "#111827",
    radius: 16,
    dimmed: false
  });
  if (!previous.has("company")) {
    company.x = 0;
    company.y = 0;
  }

  const projectIssueCount = new Map<string, number>();
  for (const id of visible.keys()) {
    const p = issueById.get(id)?.projectId;
    if (p) projectIssueCount.set(p, (projectIssueCount.get(p) ?? 0) + 1);
  }
  for (const p of data.projects) {
    if (filters.projectId && p.id !== filters.projectId) continue;
    const count = projectIssueCount.get(p.id) ?? 0;
    if (!count && (filters.agentId || filters.projectId)) continue;
    add(
      {
        id: `project:${p.id}`,
        kind: "project",
        label: p.name,
        sublabel: `${count} tarefas`,
        status: null,
        color: p.color || PROJECT_COLOR,
        radius: 9 + Math.min(10, Math.sqrt(count) * 1.4),
        dimmed: false
      },
      company
    );
  }

  // Add issues parents-first so children spawn next to their parent.
  const depth = (i: GraphIssue) => {
    let d = 0;
    let cur = i;
    while (cur.parentId && visible.has(cur.parentId) && d < 50) {
      cur = issueById.get(cur.parentId)!;
      d++;
    }
    return d;
  };
  const ordered = [...visible.keys()].map((id) => issueById.get(id)!).sort((a, b) => depth(a) - depth(b));
  const links: SimLink[] = [];
  for (const i of ordered) {
    const parentNode =
      (i.parentId && nodeById.get(i.parentId)) || (i.projectId && nodeById.get(`project:${i.projectId}`)) || company;
    const kids = childCount.get(i.id) ?? 0;
    const agent = i.assigneeAgentId ? agentName.get(i.assigneeAgentId) : null;
    const node = add(
      {
        id: i.id,
        kind: "issue",
        label: i.identifier ?? i.title,
        sublabel: [i.title, STATUS[i.status]?.label ?? i.status, agent].filter(Boolean).join(" · "),
        status: i.status,
        color: STATUS[i.status]?.color ?? "#8b8f98",
        radius: 4 + Math.min(8, Math.sqrt(kids) * 1.8),
        dimmed: visible.get(i.id) === true
      },
      parentNode
    );
    links.push({ source: parentNode, target: node, kind: "tree" });
  }
  for (const n of nodes) if (n.kind === "project") links.push({ source: company, target: n, kind: "tree" });

  if (filters.showBlocks) {
    for (const i of ordered) {
      const target = nodeById.get(i.id);
      for (const blockerId of i.blockedByIds) {
        const source = nodeById.get(blockerId);
        if (source && target) links.push({ source, target, kind: "blocks" });
      }
    }
  }
  return { nodes, links, issueById };
}

export function GraphPage({ context }: PluginPageProps) {
  const companyId = context.companyId ?? "";
  const navigation = useHostNavigation();
  const { data, loading, error, refresh } = usePluginData<GraphPayload>(DATA_KEY_GRAPH, { companyId });

  const [filters, setFilters] = useState<Filters>({ projectId: "", agentId: "", showClosed: false, showBlocks: true });
  const [search, setSearch] = useState("");
  const [hover, setHover] = useState<SimNode | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef(new ForceSim());
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  const hoverRef = useRef<SimNode | null>(null);
  const searchRef = useRef("");
  const dirtyRef = useRef(true);
  const neighborsRef = useRef(new Map<string, Set<string>>());

  useEffect(() => {
    const id = window.setInterval(() => refresh(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  const agentName = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.id, a.name])), [data]);

  useEffect(() => {
    if (!data) return;
    const previous = new Map(simRef.current.nodes.map((n) => [n.id, n]));
    const built = buildGraph(data, filters, previous, agentName);
    const neighbors = new Map<string, Set<string>>();
    for (const l of built.links) {
      if (!neighbors.has(l.source.id)) neighbors.set(l.source.id, new Set());
      if (!neighbors.has(l.target.id)) neighbors.set(l.target.id, new Set());
      neighbors.get(l.source.id)!.add(l.target.id);
      neighbors.get(l.target.id)!.add(l.source.id);
    }
    neighborsRef.current = neighbors;
    simRef.current.setGraph(built.nodes, built.links);
    if (previous.size > 0) simRef.current.alpha = 0.5;
    dirtyRef.current = true;
  }, [data, filters, agentName]);

  useEffect(() => {
    searchRef.current = search.trim().toLowerCase();
    dirtyRef.current = true;
  }, [search]);

  // Render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirtyRef.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    resize();

    const draw = () => {
      const sim = simRef.current;
      const running = sim.running;
      if (running) {
        sim.tick();
        sim.tick();
      }
      if (running || dirtyRef.current) {
        dirtyRef.current = false;
        const dark = isDark();
        const fg = dark ? "#e5e7eb" : "#111827";
        const muted = dark ? "rgba(229,231,235,0.18)" : "rgba(17,24,39,0.16)";
        const view = viewRef.current;
        const hovered = hoverRef.current;
        const near = hovered ? neighborsRef.current.get(hovered.id) : undefined;
        const query = searchRef.current;
        const isMatch = (n: SimNode) =>
          query !== "" && (n.label.toLowerCase().includes(query) || n.sublabel.toLowerCase().includes(query));
        const focus = (n: SimNode) => !hovered || n === hovered || (near?.has(n.id) ?? false);

        ctx.clearRect(0, 0, width, height);
        ctx.save();
        ctx.translate(width / 2 + view.x, height / 2 + view.y);
        ctx.scale(view.k, view.k);

        for (const l of sim.links) {
          const lit = hovered && (l.source === hovered || l.target === hovered);
          ctx.globalAlpha = hovered && !lit ? 0.12 : 1;
          if (l.kind === "blocks") {
            ctx.strokeStyle = "rgba(239,68,68,0.75)";
            ctx.setLineDash([4 / view.k, 4 / view.k]);
            ctx.lineWidth = 1.2 / view.k;
          } else {
            ctx.strokeStyle = lit ? fg : muted;
            ctx.setLineDash([]);
            ctx.lineWidth = (lit ? 1.6 : 1) / view.k;
          }
          ctx.beginPath();
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
          ctx.stroke();
          if (l.kind === "blocks") {
            // Arrowhead at the blocked task.
            const angle = Math.atan2(l.target.y - l.source.y, l.target.x - l.source.x);
            const tipX = l.target.x - Math.cos(angle) * (l.target.radius + 2);
            const tipY = l.target.y - Math.sin(angle) * (l.target.radius + 2);
            const size = 6 / view.k;
            ctx.setLineDash([]);
            ctx.fillStyle = "rgba(239,68,68,0.85)";
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(tipX - Math.cos(angle - 0.4) * size, tipY - Math.sin(angle - 0.4) * size);
            ctx.lineTo(tipX - Math.cos(angle + 0.4) * size, tipY - Math.sin(angle + 0.4) * size);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.setLineDash([]);

        for (const n of sim.nodes) {
          const inFocus = focus(n);
          ctx.globalAlpha = !inFocus ? 0.15 : n.dimmed ? 0.4 : 1;
          ctx.fillStyle = n.color;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
          ctx.fill();
          if (n.kind === "project") {
            ctx.lineWidth = 2 / view.k;
            ctx.strokeStyle = fg;
            ctx.stroke();
          }
          if (isMatch(n)) {
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2.5 / view.k;
            ctx.strokeStyle = "#facc15";
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.radius + 4 / view.k, 0, Math.PI * 2);
            ctx.stroke();
          }
          const showLabel =
            n.kind !== "issue" || view.k > 1.3 || n === hovered || (hovered && near?.has(n.id)) || isMatch(n);
          if (showLabel && inFocus) {
            ctx.globalAlpha = n.dimmed ? 0.55 : 1;
            ctx.fillStyle = fg;
            const size = n.kind === "company" ? 14 : n.kind === "project" ? 12 : 10;
            ctx.font = `${n.kind === "issue" ? 400 : 600} ${size / view.k}px system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(n.label, n.x, n.y + n.radius + 3 / view.k);
          }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Pointer interaction: pan, zoom, drag nodes, hover, click to open.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const toWorld = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      return {
        x: (clientX - rect.left - rect.width / 2 - view.x) / view.k,
        y: (clientY - rect.top - rect.height / 2 - view.y) / view.k
      };
    };
    const pick = (clientX: number, clientY: number) => {
      const p = toWorld(clientX, clientY);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of simRef.current.nodes) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < n.radius + 4 / viewRef.current.k && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    };

    let drag: { node: SimNode | null; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null = null;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const node = pick(e.clientX, e.clientY);
      drag = { node, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      if (node) node.fixed = true;
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
        if (drag.node) {
          const p = toWorld(e.clientX, e.clientY);
          drag.node.x = p.x;
          drag.node.y = p.y;
          simRef.current.reheat(0.3);
        } else {
          viewRef.current.x += e.clientX - drag.lastX;
          viewRef.current.y += e.clientY - drag.lastY;
        }
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
        dirtyRef.current = true;
        return;
      }
      const node = pick(e.clientX, e.clientY);
      if (node !== hoverRef.current) {
        hoverRef.current = node;
        setHover(node);
        canvas.style.cursor = node ? "pointer" : "grab";
        dirtyRef.current = true;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const { node, moved } = drag;
      if (node) node.fixed = false;
      drag = null;
      canvas.releasePointerCapture(e.pointerId);
      if (!moved && node) {
        if (node.kind === "issue") navigation.navigate(`/issues/${node.id}`);
        else if (node.kind === "project") navigation.navigate(`/projects/${node.id.slice("project:".length)}`);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const view = viewRef.current;
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      const k = Math.min(6, Math.max(0.1, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = mx - ((mx - view.x) * k) / view.k;
      view.y = my - ((my - view.y) * k) / view.k;
      view.k = k;
      dirtyRef.current = true;
    };
    const onLeave = () => {
      if (hoverRef.current) {
        hoverRef.current = null;
        setHover(null);
        dirtyRef.current = true;
      }
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [navigation]);

  const focusFirstMatch = () => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const n = simRef.current.nodes.find((x) => x.label.toLowerCase().includes(q) || x.sublabel.toLowerCase().includes(q));
    if (!n) return;
    const view = viewRef.current;
    view.k = Math.max(view.k, 1.6);
    view.x = -n.x * view.k;
    view.y = -n.y * view.k;
    dirtyRef.current = true;
  };

  const resetView = () => {
    viewRef.current = { x: 0, y: 0, k: 1 };
    simRef.current.reheat(0.8);
    dirtyRef.current = true;
  };

  const issueCount = simRef.current.nodes.filter((n) => n.kind === "issue").length;
  const control: CSSProperties = {
    font: "inherit",
    fontSize: 13,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--border, rgba(127,127,127,0.35))",
    background: "var(--background, transparent)",
    color: "inherit"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "calc(100vh - 96px)", minHeight: 420 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
        <strong style={{ fontSize: 15, marginRight: 4 }}>Grafo de tarefas</strong>
        <input
          style={{ ...control, minWidth: 200 }}
          placeholder="Buscar (ex.: SIM-190) e Enter"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && focusFirstMatch()}
        />
        <select style={control} value={filters.projectId} onChange={(e) => setFilters({ ...filters, projectId: e.target.value })}>
          <option value="">Todos os projetos</option>
          {(data?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select style={control} value={filters.agentId} onChange={(e) => setFilters({ ...filters, agentId: e.target.value })}>
          <option value="">Todos os agentes</option>
          {(data?.agents ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={filters.showClosed} onChange={(e) => setFilters({ ...filters, showClosed: e.target.checked })} />
          Concluídas/canceladas
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <input type="checkbox" checked={filters.showBlocks} onChange={(e) => setFilters({ ...filters, showBlocks: e.target.checked })} />
          Dependências
        </label>
        <button style={{ ...control, cursor: "pointer" }} onClick={resetView}>
          Centralizar
        </button>
        <button style={{ ...control, cursor: "pointer" }} onClick={() => refresh()} disabled={loading}>
          {loading ? "Carregando…" : "Recarregar"}
        </button>
        <span style={{ opacity: 0.7 }}>{data ? `${issueCount} tarefas no grafo` : ""}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 12, opacity: 0.85 }}>
        {Object.entries(STATUS).map(([key, s]) => (
          <span key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, display: "inline-block" }} />
            {s.label}
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 18, borderTop: "2px dashed #ef4444", display: "inline-block" }} />
          bloqueia →
        </span>
        <span style={{ opacity: 0.7 }}>Roda do mouse: zoom · arrastar: mover · clique: abrir</span>
      </div>

      {error ? (
        <div style={{ color: "#ef4444", fontSize: 13 }}>Falha ao carregar o grafo: {error.message}</div>
      ) : null}
      {data?.truncated ? (
        <div style={{ fontSize: 12, opacity: 0.8 }}>Mostrando só as primeiras 5000 tarefas.</div>
      ) : null}

      <div
        ref={wrapRef}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          borderRadius: 8,
          border: "1px solid var(--border, rgba(127,127,127,0.25))",
          overflow: "hidden"
        }}
      >
        <canvas ref={canvasRef} style={{ display: "block", cursor: "grab", touchAction: "none" }} />
        {!data && loading ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: 0.7 }}>Carregando…</div>
        ) : null}
        {hover ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              maxWidth: 460,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 12,
              background: "var(--popover, rgba(20,20,20,0.9))",
              color: "var(--popover-foreground, #fff)",
              border: "1px solid var(--border, rgba(127,127,127,0.35))",
              pointerEvents: "none"
            }}
          >
            <div style={{ fontWeight: 600 }}>{hover.label}</div>
            <div style={{ opacity: 0.85 }}>{hover.sublabel}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
