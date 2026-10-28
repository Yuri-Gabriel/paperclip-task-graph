import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclip-task-graph",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Task Graph",
  description: "Obsidian-style graph of projects, tasks, subtasks and their dependencies",
  author: "Simbora",
  categories: ["ui"],
  capabilities: [
    "companies.read",
    "projects.read",
    "issues.read",
    "issue.relations.read",
    "agents.read",
    "ui.page.register",
    "ui.sidebar.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      { type: "page", id: "graph", displayName: "Task Graph", exportName: "GraphPage", routePath: "task-graph" },
      { type: "sidebar", id: "nav", displayName: "Task Graph", exportName: "SidebarLink" }
    ]
  }
};

export default manifest;
