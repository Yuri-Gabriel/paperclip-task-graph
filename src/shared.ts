export const DATA_KEY_GRAPH = "graph";
export const ROUTE_PATH = "task-graph";

export interface GraphProject {
  id: string;
  name: string;
  color: string | null;
}

export interface GraphIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string | null;
  projectId: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  blockedByIds: string[];
  updatedAt: string | null;
}

export interface GraphAgent {
  id: string;
  name: string;
}

export interface GraphPayload {
  companyName: string;
  projects: GraphProject[];
  issues: GraphIssue[];
  agents: GraphAgent[];
  truncated: boolean;
  generatedAt: string;
}
