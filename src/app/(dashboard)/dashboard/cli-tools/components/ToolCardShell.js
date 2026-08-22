"use client";

import { Card } from "@/shared/components";
import Image from "next/image";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { useToolConfig } from "./useToolConfig";

/**
 * ToolCardShell — shared layout + state rendering for CLI ToolCards.
 *
 * Wraps useToolConfig to provide the common card structure:
 *   - Collapsible header with tool icon/name/status badge
 *   - Config status detection (configured / not_configured / other)
 *   - API key selector + model selector + apply/reset buttons
 *   - Status check indicator + message display
 *
 * Tool-specific content (custom fields, extra steps, notes) goes in the
 * `children` render prop.
 *
 * Usage:
 *   <ToolCardShell tool={tool} settingsEndpoint="/api/cli-tools/cline-settings" {...commonProps}>
 *     {({ status, selectedModel, setSelectedModel, handleApply }) => (
 *       <>...tool-specific UI...</>
 *     )}
 *   </ToolCardShell>
 */
export default function ToolCardShell({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  settingsEndpoint,
  settingsModelField,
  children,
}) {
  const {
    status,
    checking,
    applying,
    restoring,
    message,
    selectedApiKey,
    setSelectedApiKey,
    selectedModel,
    setSelectedModel,
    modelAliases,
    checkStatus,
    handleApply,
    handleReset,
  } = useToolConfig(settingsEndpoint, isExpanded, {
    apiKeys,
    baseUrl,
    cloudEnabled,
    initialStatus,
    settingsModelField,
  });

  // Config status detection
  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.hasExtremeRouter) return "not_configured";
    const url = status.settings?.openAiBaseUrl || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };
  const configStatus = getConfigStatus();

  const StatusBadge = () => {
    if (checking) return <span className="text-xs text-text-muted animate-pulse">Checking...</span>;
    if (!status?.installed) return <span className="text-xs text-red-500">Not installed</span>;
    if (configStatus === "configured")
      return <span className="text-xs text-green-500 font-medium flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">check_circle</span>Configured</span>;
    if (configStatus === "not_configured")
      return <span className="text-xs text-amber-500 font-medium">Not configured</span>;
    return <span className="text-xs text-text-muted">Installed</span>;
  };

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
        onClick={onToggle}
      >
        {tool.image ? (
          <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" />
        ) : (
          <div className="size-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: tool.color }}>
            {tool.name?.charAt(0) || "?"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-main truncate">{tool.name}</h3>
          <p className="text-xs text-text-muted truncate">{tool.description}</p>
        </div>
        <StatusBadge />
        <span className={`material-symbols-outlined text-text-muted transition-transform ${isExpanded ? "rotate-180" : ""}`}>
          expand_more
        </span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border-subtle p-4 flex flex-col gap-3">
          {message && (
            <div
              className={`p-2 rounded text-xs ${
                message.type === "success"
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400"
              }`}
            >
              {message.text}
            </div>
          )}

          {typeof children === "function"
            ? children({
                status,
                checking,
                applying,
                restoring,
                message,
                selectedApiKey,
                setSelectedApiKey,
                selectedModel,
                setSelectedModel,
                modelAliases,
                checkStatus,
                handleApply,
                handleReset,
                configStatus,
                cloudEnabled,
                tunnelEnabled,
                tunnelPublicUrl,
                tailscaleEnabled,
                tailscaleUrl,
              })
            : children}
        </div>
      )}
    </Card>
  );
}
