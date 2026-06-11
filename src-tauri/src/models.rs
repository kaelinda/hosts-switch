use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub version: u32,
    pub groups: Vec<HostGroup>,
    pub preferences: Preferences,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostGroup {
    pub id: String,
    pub name: String,
    pub nodes: Vec<HostNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostNode {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub enforce_one_active_per_group: bool,
    pub preview_on_hover: bool,
    #[serde(default)]
    pub launch_at_login: bool,
    #[serde(default = "default_enable_global_shortcut")]
    pub enable_global_shortcut: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostsSnapshot {
    pub current: String,
    pub managed: String,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub group_id: String,
    pub group_name: String,
    pub node_id: String,
    pub node_name: String,
    pub line_number: usize,
    pub severity: ValidationSeverity,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ValidationSeverity {
    Error,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            enforce_one_active_per_group: true,
            preview_on_hover: true,
            launch_at_login: false,
            enable_global_shortcut: true,
        }
    }
}

fn default_enable_global_shortcut() -> bool {
    true
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            version: 1,
            groups: vec![
                HostGroup {
                    id: new_id(),
                    name: "Development".to_string(),
                    nodes: vec![
                        HostNode {
                            id: new_id(),
                            name: "Local API".to_string(),
                            enabled: false,
                            content: "127.0.0.1 api.local.test\n127.0.0.1 web.local.test"
                                .to_string(),
                        },
                        HostNode {
                            id: new_id(),
                            name: "Staging API".to_string(),
                            enabled: false,
                            content: "10.0.0.20 api.local.test\n10.0.0.21 web.local.test"
                                .to_string(),
                        },
                    ],
                },
                HostGroup {
                    id: new_id(),
                    name: "Examples".to_string(),
                    nodes: vec![HostNode {
                        id: new_id(),
                        name: "Demo Domain".to_string(),
                        enabled: false,
                        content: "93.184.216.34 example.test".to_string(),
                    }],
                },
            ],
            preferences: Preferences::default(),
        }
    }
}

pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}
