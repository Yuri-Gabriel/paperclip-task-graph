// Small dependency-free force simulation (repulsion + springs + gravity),
// tuned for a few thousand nodes on a canvas.

export type NodeKind = "company" | "project" | "issue";

export interface SimNode {
  id: string;
  kind: NodeKind;
  label: string;
  sublabel: string;
  status: string | null;
  color: string;
  radius: number;
  dimmed: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

export type LinkKind = "tree" | "blocks";

export interface SimLink {
  source: SimNode;
  target: SimNode;
  kind: LinkKind;
}

const CELL = 220;

export class ForceSim {
  nodes: SimNode[] = [];
  links: SimLink[] = [];
  alpha = 1;

  setGraph(nodes: SimNode[], links: SimLink[]) {
    this.nodes = nodes;
    this.links = links;
    this.alpha = 1;
  }

  reheat(value = 0.6) {
    this.alpha = Math.max(this.alpha, value);
  }

  get running() {
    return this.alpha > 0.004;
  }

  tick() {
    if (!this.running) return;
    const nodes = this.nodes;
    const alpha = this.alpha;

    // Repulsion, bucketed in a grid so distant pairs are skipped.
    const grid = new Map<string, SimNode[]>();
    for (const n of nodes) {
      const key = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(n);
      else grid.set(key, [n]);
    }
    for (const n of nodes) {
      const gx = Math.floor(n.x / CELL);
      const gy = Math.floor(n.y / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = grid.get(`${gx + dx},${gy + dy}`);
          if (!bucket) continue;
          for (const m of bucket) {
            if (m === n) continue;
            let ddx = n.x - m.x;
            let ddy = n.y - m.y;
            let d2 = ddx * ddx + ddy * ddy;
            if (d2 < 0.01) {
              ddx = Math.random() - 0.5;
              ddy = Math.random() - 0.5;
              d2 = 0.25;
            }
            if (d2 > CELL * CELL) continue;
            const strength = (900 * (m.radius / 6)) / d2;
            n.vx += ddx * strength * alpha;
            n.vy += ddy * strength * alpha;
          }
        }
      }
    }

    // Springs.
    for (const l of this.links) {
      const dx = l.target.x - l.source.x;
      const dy = l.target.y - l.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = l.kind === "blocks" ? 90 : l.source.kind === "company" ? 160 : l.source.kind === "project" ? 90 : 55;
      const k = l.kind === "blocks" ? 0.02 : 0.08;
      const f = ((dist - rest) / dist) * k * alpha;
      const fx = dx * f;
      const fy = dy * f;
      l.target.vx -= fx;
      l.target.vy -= fy;
      l.source.vx += fx;
      l.source.vy += fy;
    }

    // Gravity towards the origin and integration.
    for (const n of nodes) {
      n.vx -= n.x * 0.004 * alpha;
      n.vy -= n.y * 0.004 * alpha;
      if (n.fixed) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
    }
    this.alpha *= 0.985;
  }
}
