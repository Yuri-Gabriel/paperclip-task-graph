import { useHostNavigation, type PluginSidebarProps } from "@paperclipai/plugin-sdk/ui";
import { ROUTE_PATH } from "../shared.js";

export { GraphPage } from "./GraphPage.js";

export function SidebarLink(_props: PluginSidebarProps) {
  const navigation = useHostNavigation();
  return (
    <a
      {...navigation.linkProps(`/${ROUTE_PATH}`)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 8px",
        borderRadius: 4,
        color: "inherit",
        textDecoration: "none"
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 7 L2.5 3 M7 7 L11.5 3.5 M7 7 L4 11.5 M7 7 L11 11" stroke="currentColor" strokeWidth="1.1" fill="none" />
        <circle cx="7" cy="7" r="2" fill="currentColor" />
        <circle cx="2.5" cy="3" r="1.4" fill="currentColor" />
        <circle cx="11.5" cy="3.5" r="1.4" fill="currentColor" />
        <circle cx="4" cy="11.5" r="1.4" fill="currentColor" />
        <circle cx="11" cy="11" r="1.4" fill="currentColor" />
      </svg>
      Grafo de tarefas
    </a>
  );
}
