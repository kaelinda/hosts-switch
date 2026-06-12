import {
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  Download,
  Eye,
  FileClock,
  FolderPlus,
  Keyboard,
  Plus,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  TimerReset,
  TriangleAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyHosts as applyHostsCommand,
  exportProfiles,
  exportProfilesToFile,
  importProfilesFromFile,
  importProfiles,
  loadAppState,
  listenToTrayStatus,
  openEditorShortcut,
  parseProfilesJson,
  previewHosts,
  readGlobalShortcutStatus,
  readLaunchAtLoginStatus,
  readHostsSnapshot,
  restoreLastHostsBackup,
  restoreLastProfilesBackup,
  restoreProfilesFromHosts,
  runtimeLabel,
  saveAppState,
  supportsNativeProfileFiles,
  syncGlobalShortcutPreference,
  syncLaunchAtLoginPreference,
  validateHostsState,
} from "./api";
import { hydrateGlobalShortcutPreference } from "./systemPreferenceHydration";
import type {
  AppState,
  HostGroup,
  HostNode,
  HostsSnapshot,
  ValidationIssue,
} from "./types";

const emptyState: AppState = {
  version: 1,
  groups: [],
  preferences: {
    enforceOneActivePerGroup: true,
    previewOnHover: true,
    launchAtLogin: false,
    enableGlobalShortcut: true,
  },
};

const profileReplaceConfirmation =
  "Replace the current profiles? Unsaved profile edits will be discarded.";

const deleteGroupConfirmation =
  "Delete this group and all of its nodes? This only changes the current draft until you save.";
const deleteNodeConfirmation =
  "Delete this node? This only changes the current draft until you save.";

function App() {
  const [state, setState] = useState<AppState>(emptyState);
  const [persisted, setPersisted] = useState<AppState>(emptyState);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HostsSnapshot | null>(null);
  const [preview, setPreview] = useState("");
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [hoverPreviewTarget, setHoverPreviewTarget] = useState<{
    groupId: string;
    nodeId: string;
  } | null>(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [profilePanelMode, setProfilePanelMode] = useState<"import" | "export" | null>(null);
  const [profileJson, setProfileJson] = useState("");
  const [status, setStatus] = useState("Loading profiles");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const hoverPreviewKeyRef = useRef<string | null>(null);

  const dirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(persisted),
    [state, persisted],
  );

  const selectedGroup = state.groups.find((group) => group.id === selectedGroupId);
  const selectedNode = selectedGroup?.nodes.find((node) => node.id === selectedNodeId);
  const selectedNodeIssues = validationIssues.filter(
    (issue) => issue.nodeId === selectedNodeId,
  );
  const applyBlocked = validationIssues.length > 0;
  const hostsSafetyBlocked = snapshot?.current.trim().length === 0;
  const isHoverPreviewing = hoverPreviewTarget !== null;
  const activeCount = state.groups.reduce(
    (total, group) => total + group.nodes.filter((node) => node.enabled).length,
    0,
  );
  const hostsWarnings = useMemo(
    () => (snapshot ? describeHostsSnapshot(snapshot) : []),
    [snapshot],
  );
  const filteredGroups = useMemo(
    () => filterGroups(state.groups, profileSearch),
    [profileSearch, state.groups],
  );

  useEffect(() => {
    void loadInitialState();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenToTrayStatus((event) => {
      if (event.state) {
        setState(event.state);
        setPersisted(event.state);
        selectFirstNode(event.state);
        void refreshSnapshot(event.state);
        void refreshValidation(event.state);
      }
      setStatus(event.status);
      setError(event.error ?? null);
    }).then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (state.groups.length === 0) {
      setValidationIssues([]);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!hoverPreviewKeyRef.current) {
        void refreshPreview(state);
      }
      void refreshValidation(state);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [hoverPreviewTarget, state]);

  async function loadInitialState() {
    await runCommand("Profiles loaded", async () => {
      const loaded = await loadAppState();
      const withLaunchAtLogin = await hydrateLaunchAtLoginStatus(loaded);
      const hydrated = await hydrateGlobalShortcutStatus(withLaunchAtLogin);
      setState(hydrated);
      setPersisted(hydrated);
      selectFirstNode(hydrated);
      await refreshSnapshot(hydrated);
      await refreshValidation(hydrated);
    });
  }

  async function hydrateLaunchAtLoginStatus(loaded: AppState) {
    let actual: boolean | null = null;
    try {
      actual = await readLaunchAtLoginStatus();
    } catch (reason) {
      setError(String(reason));
      setStatus("Could not read launch-at-login status");
    }
    if (actual === null || actual === loaded.preferences.launchAtLogin) {
      return loaded;
    }

    return saveAppState({
      ...loaded,
      preferences: {
        ...loaded.preferences,
        launchAtLogin: actual,
      },
    });
  }

  async function hydrateGlobalShortcutStatus(loaded: AppState) {
    return hydrateGlobalShortcutPreference(loaded, {
      readStatus: readGlobalShortcutStatus,
      syncPreference: syncGlobalShortcutPreference,
      saveState: saveAppState,
      reportError: setError,
      reportStatus: setStatus,
    });
  }

  async function refreshSnapshot(nextState = state) {
    const nextSnapshot = await readHostsSnapshot(nextState);
    setSnapshot(nextSnapshot);
    setPreview(nextSnapshot.preview);
  }

  async function refreshPreview(nextState = state) {
    try {
      const nextPreview = await previewHosts(nextState);
      setPreview(nextPreview);
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function refreshValidation(nextState = state) {
    try {
      setValidationIssues(await validateHostsState(nextState));
    } catch (reason) {
      setError(String(reason));
    }
  }

  async function runCommand(successMessage: string, action: () => Promise<void>) {
    setIsBusy(true);
    setError(null);
    try {
      await action();
      setStatus(successMessage);
    } catch (reason) {
      setError(String(reason));
      setStatus("Action failed");
    } finally {
      setIsBusy(false);
    }
  }

  function updateState(updater: (current: AppState) => AppState) {
    setState((current) => normalizeSelection(updater(current)));
  }

  function normalizeSelection(next: AppState) {
    if (next.groups.length === 0) {
      setSelectedGroupId(null);
      setSelectedNodeId(null);
      return next;
    }

    const groupStillExists = next.groups.some((group) => group.id === selectedGroupId);
    const nextGroup = groupStillExists
      ? next.groups.find((group) => group.id === selectedGroupId)!
      : next.groups[0];

    const nodeStillExists = nextGroup.nodes.some((node) => node.id === selectedNodeId);
    setSelectedGroupId(nextGroup.id);
    setSelectedNodeId(nodeStillExists ? selectedNodeId : nextGroup.nodes[0]?.id ?? null);
    return next;
  }

  function selectFirstNode(next: AppState) {
    const firstGroup = next.groups[0];
    setSelectedGroupId(firstGroup?.id ?? null);
    setSelectedNodeId(firstGroup?.nodes[0]?.id ?? null);
  }

  function createId(prefix: string) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  function addGroup() {
    const group: HostGroup = {
      id: createId("group"),
      name: "New Group",
      nodes: [
        {
          id: createId("node"),
          name: "New Node",
          enabled: false,
          content: "127.0.0.1 example.local",
        },
      ],
    };
    updateState((current) => ({ ...current, groups: [...current.groups, group] }));
    setSelectedGroupId(group.id);
    setSelectedNodeId(group.nodes[0].id);
  }

  function addNode(groupId: string) {
    const node: HostNode = {
      id: createId("node"),
      name: "New Node",
      enabled: false,
      content: "127.0.0.1 example.local",
    };
    updateState((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId ? { ...group, nodes: [...group.nodes, node] } : group,
      ),
    }));
    setSelectedGroupId(groupId);
    setSelectedNodeId(node.id);
  }

  function toggleNode(groupId: string, nodeId: string) {
    updateState((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          nodes: group.nodes.map((node) => {
            if (node.id === nodeId) {
              return { ...node, enabled: !node.enabled };
            }
            if (current.preferences.enforceOneActivePerGroup) {
              return { ...node, enabled: false };
            }
            return node;
          }),
        };
      }),
    }));
  }

  async function previewNodeOnHover(groupId: string, nodeId: string) {
    if (!state.preferences.previewOnHover || profilePanelMode) {
      return;
    }
    const previewState = stateWithPreviewNode(state, groupId, nodeId);
    const key = `${groupId}:${nodeId}`;
    hoverPreviewKeyRef.current = key;
    setHoverPreviewTarget({ groupId, nodeId });
    try {
      const nextPreview = await previewHosts(previewState);
      if (hoverPreviewKeyRef.current === key) {
        setPreview(nextPreview);
      }
    } catch (reason) {
      setError(String(reason));
    }
  }

  function clearHoverPreview() {
    if (!hoverPreviewTarget && !hoverPreviewKeyRef.current) {
      return;
    }
    hoverPreviewKeyRef.current = null;
    setHoverPreviewTarget(null);
    void refreshPreview(state);
  }

  function updateSelectedNode(patch: Partial<HostNode>) {
    if (!selectedGroupId || !selectedNodeId) {
      return;
    }
    updateState((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === selectedGroupId
          ? {
              ...group,
              nodes: group.nodes.map((node) =>
                node.id === selectedNodeId ? { ...node, ...patch } : node,
              ),
            }
          : group,
      ),
    }));
  }

  function updateGroupName(groupId: string, name: string) {
    updateState((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId ? { ...group, name } : group,
      ),
    }));
  }

  function removeSelectedNode() {
    if (!selectedGroupId || !selectedNodeId) {
      return;
    }
    if (!window.confirm(deleteNodeConfirmation)) {
      setStatus("Delete node cancelled");
      return;
    }
    updateState((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === selectedGroupId
          ? {
              ...group,
              nodes: group.nodes.filter((node) => node.id !== selectedNodeId),
            }
          : group,
      ),
    }));
  }

  function removeSelectedGroup() {
    if (!selectedGroupId) {
      return;
    }
    if (!window.confirm(deleteGroupConfirmation)) {
      setStatus("Delete group cancelled");
      return;
    }
    updateState((current) => ({
      ...current,
      groups: current.groups.filter((group) => group.id !== selectedGroupId),
    }));
  }

  function moveGroup(groupId: string, direction: -1 | 1) {
    updateState((current) => {
      const index = current.groups.findIndex((group) => group.id === groupId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.groups.length) {
        return current;
      }
      const groups = [...current.groups];
      [groups[index], groups[target]] = [groups[target], groups[index]];
      return { ...current, groups };
    });
  }

  function moveNode(groupId: string, nodeId: string, direction: -1 | 1) {
    updateState((current) => ({
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        const index = group.nodes.findIndex((node) => node.id === nodeId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= group.nodes.length) {
          return group;
        }
        const nodes = [...group.nodes];
        [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
        return { ...group, nodes };
      }),
    }));
  }

  async function saveProfiles() {
    await runCommand("Profiles saved", async () => {
      clearHoverPreviewState();
      const saved = await saveAppState(state);
      setState(saved);
      setPersisted(saved);
      await refreshSnapshot(saved);
      await refreshValidation(saved);
    });
  }

  async function applyHosts() {
    const issues = await validateHostsState(state);
    setValidationIssues(issues);
    if (issues.length > 0) {
      const issue = issues[0];
      setStatus("Fix hosts validation errors before applying");
      setError(`${issue.groupName} / ${issue.nodeName} line ${issue.lineNumber}: ${issue.message}`);
      return;
    }

    await runCommand("Hosts applied", async () => {
      clearHoverPreviewState();
      const saved = await applyHostsCommand(state);
      setState(saved);
      setPersisted(saved);
      await refreshSnapshot(saved);
      await refreshValidation(saved);
    });
  }

  async function restoreProfiles() {
    if (!window.confirm(profileReplaceConfirmation)) {
      setStatus("Restore profiles cancelled");
      return;
    }

    await runCommand("Profiles restored from /etc/hosts", async () => {
      clearHoverPreviewState();
      const restored = await restoreProfilesFromHosts();
      setState(restored);
      setPersisted(restored);
      selectFirstNode(restored);
      await refreshSnapshot(restored);
      await refreshValidation(restored);
    });
  }

  async function restoreLastBackup() {
    const confirmed = window.confirm(
      "Restore the latest /etc/hosts backup? This may ask for administrator privileges and replace the current hosts file.",
    );
    if (!confirmed) {
      setStatus("Restore backup cancelled");
      return;
    }

    await runCommand("Last hosts backup restored", async () => {
      clearHoverPreviewState();
      await restoreLastHostsBackup();
      await refreshSnapshot(state);
    });
  }

  async function restoreProfilesBackup() {
    if (!window.confirm(profileReplaceConfirmation)) {
      setStatus("Restore profiles backup cancelled");
      return;
    }

    await runCommand("Last profiles backup restored", async () => {
      clearHoverPreviewState();
      const restored = await restoreLastProfilesBackup();
      setState(restored);
      setPersisted(restored);
      selectFirstNode(restored);
      await refreshSnapshot(restored);
      await refreshValidation(restored);
    });
  }

  async function openExportProfiles() {
    if (supportsNativeProfileFiles()) {
      await runCommand("Profiles JSON exported to file", async () => {
        const exported = await exportProfilesToFile(state);
        if (!exported) {
          setStatus("Export cancelled");
        }
      });
      return;
    }

    await runCommand("Profiles JSON exported", async () => {
      setProfileJson(await exportProfiles(state));
      setProfilePanelMode("export");
    });
  }

  async function openImportProfiles() {
    if (supportsNativeProfileFiles()) {
      if (!window.confirm(profileReplaceConfirmation)) {
        setStatus("Import cancelled");
        return;
      }

      await runCommand("Profiles imported from file", async () => {
        clearHoverPreviewState();
        const imported = await importProfilesFromFile();
        if (!imported) {
          setStatus("Import cancelled");
          return;
        }
        setState(imported);
        setPersisted(imported);
        selectFirstNode(imported);
        await refreshSnapshot(imported);
        await refreshValidation(imported);
      });
      return;
    }

    setError(null);
    setProfileJson("");
    setProfilePanelMode("import");
    setStatus("Import profiles JSON");
  }

  async function confirmImportProfiles() {
    try {
      parseProfilesJson(profileJson);
    } catch (error) {
      setError(String(error));
      setStatus("Import failed");
      return;
    }

    if (!window.confirm(profileReplaceConfirmation)) {
      setStatus("Import cancelled");
      return;
    }

    await runCommand("Profiles imported", async () => {
      clearHoverPreviewState();
      const imported = await importProfiles(profileJson);
      setState(imported);
      setPersisted(imported);
      selectFirstNode(imported);
      setProfilePanelMode(null);
      setProfileJson("");
      await refreshSnapshot(imported);
      await refreshValidation(imported);
    });
  }

  async function copyProfilesJson() {
    await navigator.clipboard.writeText(profileJson);
    setStatus("Profiles JSON copied");
  }

  function closeProfilePanel() {
    setProfilePanelMode(null);
    setProfileJson("");
  }

  async function copyPreview() {
    await navigator.clipboard.writeText(preview);
    setStatus("Preview copied");
  }

  function revertDraft() {
    setState(persisted);
    selectFirstNode(persisted);
    clearHoverPreviewState();
    void refreshValidation(persisted);
    setStatus("Draft reverted");
  }

  function clearHoverPreviewState() {
    hoverPreviewKeyRef.current = null;
    setHoverPreviewTarget(null);
  }

  async function toggleLaunchAtLogin(launchAtLogin: boolean) {
    await runCommand(
      launchAtLogin ? "Launch at login enabled" : "Launch at login disabled",
      async () => {
        const requestedState = {
          ...state,
          preferences: {
            ...state.preferences,
            launchAtLogin,
          },
        };
        const actual = await syncLaunchAtLoginPreference(requestedState);
        const persistedWithPreference = {
          ...persisted,
          preferences: {
            ...persisted.preferences,
            launchAtLogin: actual,
          },
        };
        const saved = await saveAppState(persistedWithPreference);
        setPersisted(saved);
        setState((current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            launchAtLogin: saved.preferences.launchAtLogin,
          },
        }));
      },
    );
  }

  async function toggleGlobalShortcut(enableGlobalShortcut: boolean) {
    await runCommand(
      enableGlobalShortcut ? "Global shortcut enabled" : "Global shortcut disabled",
      async () => {
        const requestedState = {
          ...state,
          preferences: {
            ...state.preferences,
            enableGlobalShortcut,
          },
        };
        const actual = await syncGlobalShortcutPreference(requestedState);
        const persistedWithPreference = {
          ...persisted,
          preferences: {
            ...persisted.preferences,
            enableGlobalShortcut: actual,
          },
        };
        const saved = await saveAppState(persistedWithPreference);
        setPersisted(saved);
        setState((current) => ({
          ...current,
          preferences: {
            ...current.preferences,
            enableGlobalShortcut: saved.preferences.enableGlobalShortcut,
          },
        }));
      },
    );
  }

  function stateWithPreviewNode(current: AppState, groupId: string, nodeId: string): AppState {
    return {
      ...current,
      groups: current.groups.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          nodes: group.nodes.map((node) => ({
            ...node,
            enabled: node.id === nodeId,
          })),
        };
      }),
    };
  }

  function filterGroups(groups: HostGroup[], query: string): HostGroup[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return groups;
    }

    return groups.flatMap((group) => {
      const groupMatches = group.name.toLowerCase().includes(normalizedQuery);
      if (groupMatches) {
        return [group];
      }

      const nodes = group.nodes.filter((node) => {
        return (
          node.name.toLowerCase().includes(normalizedQuery) ||
          node.content.toLowerCase().includes(normalizedQuery)
        );
      });
      return nodes.length > 0 ? [{ ...group, nodes }] : [];
    });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>Hosts Switch</h1>
          <p>{activeCount} active nodes · /etc/hosts managed block preview · {runtimeLabel}</p>
        </div>
        <div className="actions">
          <button className="icon-button" onClick={() => void openImportProfiles()} disabled={isBusy} title="Import profiles JSON">
            <Upload size={17} />
          </button>
          <button className="icon-button" onClick={openExportProfiles} disabled={isBusy} title="Export profiles JSON">
            <Download size={17} />
          </button>
          <button className="icon-button" onClick={restoreProfiles} disabled={isBusy} title="Restore profiles from /etc/hosts">
            <FileClock size={17} />
          </button>
          <button className="icon-button" onClick={restoreProfilesBackup} disabled={isBusy} title="Restore last profiles backup">
            <TimerReset size={17} />
          </button>
          <button className="icon-button" onClick={restoreLastBackup} disabled={isBusy} title="Restore last hosts backup">
            <ArchiveRestore size={17} />
          </button>
          <button className="icon-button" onClick={revertDraft} disabled={!dirty || isBusy} title="Revert draft">
            <RotateCcw size={17} />
          </button>
          <button onClick={saveProfiles} disabled={!dirty || isBusy}>
            <Save size={17} />
            Save
          </button>
          <button
            className="primary"
            onClick={applyHosts}
            disabled={isBusy || applyBlocked || hostsSafetyBlocked}
          >
            <ShieldCheck size={17} />
            Apply
          </button>
        </div>
      </header>

      <section className="status-stack">
        <div className="statusline" data-error={Boolean(error)}>
          <span>{error ?? status}</span>
          <strong>
            {isHoverPreviewing
              ? "Hover preview"
              : hostsSafetyBlocked
                ? "Hosts blocked"
              : validationIssues.length > 0
              ? `${validationIssues.length} validation error${validationIssues.length === 1 ? "" : "s"}`
              : dirty
                ? "Unsaved draft"
                : "Saved"}
          </strong>
        </div>
        {hostsWarnings.length > 0 ? (
          <div className="hosts-alert" role="status">
            <TriangleAlert size={15} />
            <span>{hostsWarnings[0]}</span>
          </div>
        ) : null}
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <div className="sidebar-header">
            <span>Groups</span>
            <button className="icon-button" onClick={addGroup} title="Add group">
              <FolderPlus size={16} />
            </button>
          </div>

          <label className="profile-search">
            <Search size={15} />
            <input
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              placeholder="Search profiles"
            />
          </label>

          <div className="group-list">
            {filteredGroups.length === 0 ? (
              <div className="empty-list">No matching profiles</div>
            ) : null}
            {filteredGroups.map((group) => (
              <div className="group" key={group.id} data-selected={group.id === selectedGroupId}>
                <button
                  className="group-title"
                  onClick={() => {
                    setSelectedGroupId(group.id);
                    setSelectedNodeId(group.nodes[0]?.id ?? null);
                  }}
                >
                  <Server size={16} />
                  <span>{group.name}</span>
                  <small>{group.nodes.filter((node) => node.enabled).length}</small>
                </button>
                <div className="node-list">
                  {group.nodes.map((node) => (
                    <button
                      key={node.id}
                      className="node-row"
                      data-selected={node.id === selectedNodeId}
                      data-invalid={validationIssues.some((issue) => issue.nodeId === node.id)}
                      data-previewing={
                        hoverPreviewTarget?.groupId === group.id &&
                        hoverPreviewTarget?.nodeId === node.id
                      }
                      onMouseEnter={() => void previewNodeOnHover(group.id, node.id)}
                      onMouseLeave={clearHoverPreview}
                      onFocus={() => void previewNodeOnHover(group.id, node.id)}
                      onBlur={clearHoverPreview}
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setSelectedNodeId(node.id);
                      }}
                    >
                      <span className="state-dot" data-enabled={node.enabled} />
                      <span>{node.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className="editor">
          {selectedGroup ? (
            <>
              <div className="editor-toolbar">
                <label>
                  Group
                  <input
                    value={selectedGroup.name}
                    onChange={(event) => updateGroupName(selectedGroup.id, event.target.value)}
                  />
                </label>
                <div className="toolbar-buttons">
                  <button className="icon-button" onClick={() => moveGroup(selectedGroup.id, -1)} title="Move group up">
                    <ChevronUp size={16} />
                  </button>
                  <button className="icon-button" onClick={() => moveGroup(selectedGroup.id, 1)} title="Move group down">
                    <ChevronDown size={16} />
                  </button>
                  <button className="icon-button" onClick={() => addNode(selectedGroup.id)} title="Add node">
                    <Plus size={16} />
                  </button>
                  <button className="icon-button danger" onClick={removeSelectedGroup} title="Delete group">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {selectedNode ? (
                <div className="node-editor">
                  <div className="node-fields">
                    <label>
                      Node
                      <input
                        value={selectedNode.name}
                        onChange={(event) => updateSelectedNode({ name: event.target.value })}
                      />
                    </label>
                    <button
                      className={selectedNode.enabled ? "toggle active" : "toggle"}
                      onClick={() => toggleNode(selectedGroup.id, selectedNode.id)}
                    >
                      <Check size={16} />
                      {selectedNode.enabled ? "Active" : "Inactive"}
                    </button>
                    <button className="icon-button" onClick={() => moveNode(selectedGroup.id, selectedNode.id, -1)} title="Move node up">
                      <ChevronUp size={16} />
                    </button>
                    <button className="icon-button" onClick={() => moveNode(selectedGroup.id, selectedNode.id, 1)} title="Move node down">
                      <ChevronDown size={16} />
                    </button>
                    <button className="icon-button danger" onClick={removeSelectedNode} title="Delete node">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <textarea
                    spellCheck={false}
                    data-invalid={selectedNodeIssues.length > 0}
                    value={selectedNode.content}
                    onChange={(event) => updateSelectedNode({ content: event.target.value })}
                  />
                  {selectedNodeIssues.length > 0 ? (
                    <div className="validation-panel">
                      <div>
                        <TriangleAlert size={16} />
                        <strong>Fix before Apply</strong>
                      </div>
                      <ul>
                        {selectedNodeIssues.map((issue) => (
                          <li key={`${issue.nodeId}-${issue.lineNumber}-${issue.message}`}>
                            Line {issue.lineNumber}: {issue.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state">
                  <button onClick={() => addNode(selectedGroup.id)}>
                    <Plus size={17} />
                    Add Node
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <button onClick={addGroup}>
                <FolderPlus size={17} />
                Add Group
              </button>
            </div>
          )}
        </section>

        <aside className="preview">
          <div className="preview-header">
            <div>
              <Eye size={16} />
              <span>{isHoverPreviewing ? "Hover Preview" : "Preview"}</span>
            </div>
            <button className="icon-button" onClick={copyPreview} title="Copy preview">
              <Copy size={16} />
            </button>
          </div>
          <pre>{preview || snapshot?.current || "No hosts content loaded."}</pre>
        </aside>
      </section>

      <footer className="settings">
        <Settings2 size={16} />
        <label>
          <input
            type="checkbox"
            checked={state.preferences.launchAtLogin}
            onChange={(event) => void toggleLaunchAtLogin(event.target.checked)}
            disabled={isBusy}
          />
          <TimerReset size={15} />
          Launch at login
        </label>
        <label title={openEditorShortcut}>
          <input
            type="checkbox"
            checked={state.preferences.enableGlobalShortcut}
            onChange={(event) => void toggleGlobalShortcut(event.target.checked)}
            disabled={isBusy}
          />
          <Keyboard size={15} />
          Global shortcut
        </label>
        <label>
          <input
            type="checkbox"
            checked={state.preferences.enforceOneActivePerGroup}
            onChange={(event) =>
              updateState((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  enforceOneActivePerGroup: event.target.checked,
                },
              }))
            }
          />
          One active node per group
        </label>
        <label>
          <input
            type="checkbox"
            checked={state.preferences.previewOnHover}
            onChange={(event) =>
              updateState((current) => ({
                ...current,
                preferences: {
                  ...current.preferences,
                  previewOnHover: event.target.checked,
                },
              }))
            }
          />
          Preview on hover
        </label>
      </footer>

      {profilePanelMode ? (
        <div className="profile-panel-backdrop" role="dialog" aria-modal="true">
          <section className="profile-panel">
            <header>
              <strong>{profilePanelMode === "import" ? "Import Profiles JSON" : "Export Profiles JSON"}</strong>
              <button className="icon-button" onClick={closeProfilePanel} title="Close">
                <X size={16} />
              </button>
            </header>
            <textarea
              className="profile-json"
              spellCheck={false}
              readOnly={profilePanelMode === "export"}
              value={profileJson}
              onChange={(event) => setProfileJson(event.target.value)}
            />
            <footer>
              {profilePanelMode === "export" ? (
                <button onClick={copyProfilesJson}>
                  <ClipboardCopy size={16} />
                  Copy JSON
                </button>
              ) : (
                <button className="primary" onClick={confirmImportProfiles} disabled={isBusy || profileJson.trim().length === 0}>
                  <Upload size={16} />
                  Import
                </button>
              )}
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function describeHostsSnapshot(snapshot: HostsSnapshot): string[] {
  if (snapshot.current.trim().length === 0) {
    return [
      "Current /etc/hosts is empty. Confirm this machine is ready before applying changes.",
    ];
  }

  return [];
}

export default App;
