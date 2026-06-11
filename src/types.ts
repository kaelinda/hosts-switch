export type HostNode = {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
};

export type HostGroup = {
  id: string;
  name: string;
  nodes: HostNode[];
};

export type Preferences = {
  enforceOneActivePerGroup: boolean;
  previewOnHover: boolean;
  launchAtLogin: boolean;
  enableGlobalShortcut: boolean;
};

export type AppState = {
  version: number;
  groups: HostGroup[];
  preferences: Preferences;
};

export type HostsSnapshot = {
  current: string;
  managed: string;
  preview: string;
};

export type ValidationIssue = {
  groupId: string;
  groupName: string;
  nodeId: string;
  nodeName: string;
  lineNumber: number;
  severity: "error";
  message: string;
};
