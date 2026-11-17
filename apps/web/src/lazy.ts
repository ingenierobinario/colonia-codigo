// The one place panel code is loaded late (AGENTS.md rule 27): every lazy screen, dialog and part is declared here once,
// and the first screen imports it from here, never the module itself: biome.json names each file below and fails a
// static import of one from App, main, shell/, inbox/ or chat/ (a new entry adds its file there). The language chunks
// (i18n/messages.ts) and the marks (data/models.ts) are the two loaded elsewhere.
import { lazy } from "react";
import { addPack } from "./i18n/index.ts";

/** A late piece waits for the late screens' strings (i18n "screens" pack) with its own code, so it never shows a bare key. */
const late: typeof lazy = (load) => lazy(() => Promise.all([load(), addPack("screens")]).then(([m]) => m));

// Windows of their own and the setup screens: the main window never loads them.
export const QuickChat = late(() => import("./quick/QuickChat.tsx").then((m) => ({ default: m.QuickChat })));
export const BrowserPanel = late(() => import("./panel/BrowserPanel.tsx").then((m) => ({ default: m.BrowserPanel })));
export const Wizard = late(() => import("./setup/Wizard.tsx").then((m) => ({ default: m.Wizard })));
export const PairScreen = late(() => import("./setup/PairScreen.tsx").then((m) => ({ default: m.PairScreen })));
export const ConnectScreen = late(() =>
  import("./setup/ConnectScreen.tsx").then((m) => ({ default: m.ConnectScreen })),
);
export const AboutScreen = late(() => import("./setup/AboutScreen.tsx").then((m) => ({ default: m.AboutScreen })));
export const ArtifactWindow = late(() =>
  import("./apps/ArtifactWindow.tsx").then((m) => ({ default: m.ArtifactWindow })),
);
export const OAuthReturn = late(() => import("./resources/OAuthReturn.tsx").then((m) => ({ default: m.OAuthReturn })));

export const AttachChips = late(() =>
  import("./chat/composer/AttachChips.tsx").then((m) => ({ default: m.AttachChips })),
);

// Screens and dialogs loaded when first opened: the chat is what the panel opens on.
export const WebAppScreen = late(() => import("./webapps/WebAppScreen.tsx").then((m) => ({ default: m.WebAppScreen })));
export const NavegadorScreen = late(() =>
  import("./navegadores/NavegadorScreen.tsx").then((m) => ({ default: m.NavegadorScreen })),
);
export const NavegadoresDock = late(() =>
  import("./navegadores/NavegadoresDock.tsx").then((m) => ({ default: m.NavegadoresDock })),
);
export const WebAppsDock = late(() => import("./webapps/WebAppsDock.tsx").then((m) => ({ default: m.WebAppsDock })));
export const AppScreen = late(() => import("./apps/AppScreen.tsx").then((m) => ({ default: m.AppScreen })));
export const ChannelScreen = late(() =>
  import("./channels/ChannelScreen.tsx").then((m) => ({ default: m.ChannelScreen })),
);
export const ConfigModal = late(() => import("./config/ConfigModal.tsx").then((m) => ({ default: m.ConfigModal })));
export const TaskPeek = late(() => import("./tasks/TaskPeek.tsx").then((m) => ({ default: m.TaskPeek })));
export const TaskBundle = late(() => import("./inbox/TaskBundle.tsx").then((m) => ({ default: m.TaskBundle })));
export const NewTask = late(() => import("./tasks/TaskForms.tsx").then((m) => ({ default: m.NewTask })));
export const TaskStatus = late(() => import("./common/TaskStatus.tsx").then((m) => ({ default: m.TaskStatus })));
export const SubthreadPart = late(() =>
  import("./chat/parts/SubthreadPart.tsx").then((m) => ({ default: m.SubthreadPart })),
);
export const AgentEvent = late(() => import("./chat/AgentEvent.tsx").then((m) => ({ default: m.AgentEvent })));
export const TaskDescription = late(() =>
  import("./chat/TaskDescription.tsx").then((m) => ({ default: m.TaskDescription })),
);
export const EngineSessions = late(() =>
  import("./engines/EngineSessions.tsx").then((m) => ({ default: m.EngineSessions })),
);
export const ProjectScreen = late(() =>
  import("./project/ProjectScreen.tsx").then((m) => ({ default: m.ProjectScreen })),
);
export const ResourcesScreen = late(() =>
  import("./project/ResourcesScreen.tsx").then((m) => ({ default: m.ResourcesScreen })),
);
export const InstallArtifactDialog = late(() =>
  import("./surfaces/InstallArtifact.tsx").then((m) => ({ default: m.InstallArtifactDialog })),
);
export const LiveLayer = late(() => import("./surfaces/LiveLayer.tsx").then((m) => ({ default: m.LiveLayer })));
export const CornerCards = late(() => import("./shell/CornerCards.tsx").then((m) => ({ default: m.CornerCards })));
export const CommandPalette = late(() =>
  import("./shell/CommandPalette.tsx").then((m) => ({ default: m.CommandPalette })),
);
export const ThreadDialogs = late(() =>
  import("./inbox/ThreadDialogs.tsx").then((m) => ({ default: m.ThreadDialogs })),
);
export const WidgetChatHost = late(() =>
  import("./surfaces/WidgetChat.tsx").then((m) => ({ default: m.WidgetChatHost })),
);
export const PhoneDialog = late(() => import("./shell/PhoneDialog.tsx").then((m) => ({ default: m.PhoneDialog })));
export const TasksScreen = late(() => import("./tasks/TasksScreen.tsx").then((m) => ({ default: m.TasksScreen })));
export const FilesScreen = late(() => import("./files/FilesScreen.tsx").then((m) => ({ default: m.FilesScreen })));
export const ComputersScreen = late(() =>
  import("./computers/ComputersScreen.tsx").then((m) => ({ default: m.ComputersScreen })),
);
export const EquiposScreen = late(() =>
  import("./equipos/EquiposScreen.tsx").then((m) => ({ default: m.EquiposScreen })),
);
export const UsageDialog = late(() => import("./shell/UsagePanels.tsx").then((m) => ({ default: m.UsageDialog })));
export const UsageSummary = late(() => import("./shell/UsagePanels.tsx").then((m) => ({ default: m.UsageSummary })));
export const RunningIndicator = late(() =>
  import("./shell/RunningIndicator.tsx").then((m) => ({ default: m.RunningIndicator })),
);
// The memory gauge shows a number only after its first read: loading it after the first screen moves nothing shown.
export const EngineUsageButton = late(() => import("./shell/EngineUsageButton.tsx"));
export const UsageButton = late(() => import("./shell/UsageButton.tsx").then((m) => ({ default: m.UsageButton })));

// The sidebar's extras: not needed for the first paint.
export const AppsDock = late(() => import("./shell/AppsDock.tsx").then((m) => ({ default: m.AppsDock })));
export const DesktopInstallNotice = late(() =>
  import("./shell/DesktopInstallNotice.tsx").then((m) => ({ default: m.DesktopInstallNotice })),
);

// Project dialogs, opened rarely.
export const ProjectAgents = late(() =>
  import("./project/ProjectTeam.tsx").then((m) => ({ default: m.ProjectAgents })),
);
export const ProjectFiles = late(() =>
  import("./project/files/ProjectFiles.tsx").then((m) => ({ default: m.ProjectFiles })),
);
export const ProjectArtifacts = late(() =>
  import("./project/ProjectArtifacts.tsx").then((m) => ({ default: m.ProjectArtifacts })),
);
export const ProjectMemory = late(() =>
  import("./project/ProjectMemory.tsx").then((m) => ({ default: m.ProjectMemory })),
);
export const ResourcesView = late(() =>
  import("./resources/ResourcesView.tsx").then((m) => ({ default: m.ResourcesView })),
);
export const RoutinesPane = late(() =>
  import("./routines/RoutinesPane.tsx").then((m) => ({ default: m.RoutinesPane })),
);
export const ProjectTasks = late(() => import("./tasks/TasksList.tsx").then((m) => ({ default: m.ProjectTasks })));
export const NewProjectDialog = late(() =>
  import("./shell/NewProjectDialog.tsx").then((m) => ({ default: m.NewProjectDialog })),
);
export const UnregisterProjectDialog = late(() =>
  import("./shell/UnregisterProjectDialog.tsx").then((m) => ({ default: m.UnregisterProjectDialog })),
);
export const ShareProjectDialog = late(() =>
  import("./project/ShareProjectDialog.tsx").then((m) => ({ default: m.ShareProjectDialog })),
);
export const ProjectSettings = late(() =>
  import("./project/ProjectSettings.tsx").then((m) => ({ default: m.ProjectSettings })),
);
// The editor of a project's tile (with the picture cropper), opened from its header or its settings.
export const ProjectMarkEditor = late(() =>
  import("./project/ProjectMarkEditor.tsx").then((m) => ({ default: m.ProjectMarkEditor })),
);

export const JobList = late(() => import("./shell/JobList.tsx").then((m) => ({ default: m.JobList })));

export const CoreBehind = late(() => import("./shell/CoreBehind.tsx").then((m) => ({ default: m.CoreBehind })));
export const UpdateDialog = late(() => import("./shell/UpdateDialog.tsx").then((m) => ({ default: m.UpdateDialog })));
export const WhatsNewDialog = late(() =>
  import("./shell/WhatsNewDialog.tsx").then((m) => ({ default: m.WhatsNewDialog })),
);

// The side panel's tabs load when first opened, not with the chat.
export const ChatFiles = late(() => import("./panel/ChatFiles.tsx").then((m) => ({ default: m.ChatFiles })));
export const UsagePanel = late(() => import("./panel/UsagePanel.tsx").then((m) => ({ default: m.UsagePanel })));
export const ChangesPanel = late(() => import("./panel/ChangesPanel.tsx").then((m) => ({ default: m.ChangesPanel })));
export const ProcessesPanel = late(() =>
  import("./panel/ProcessesPanel.tsx").then((m) => ({ default: m.ProcessesPanel })),
);
export const TerminalPanel = late(() =>
  import("./panel/TerminalPanel.tsx").then((m) => ({ default: m.TerminalPanel })),
);
export const WidgetPanel = late(() => import("./panel/WidgetPanel.tsx").then((m) => ({ default: m.WidgetPanel })));
export const AgentPanel = late(() => import("./panel/AgentPanel.tsx").then((m) => ({ default: m.AgentPanel })));
export const DocumentPanel = late(() =>
  import("./panel/DocumentPanel.tsx").then((m) => ({ default: m.DocumentPanel })),
);
export const ComputerPanel = late(() =>
  import("./panel/ComputerPanel.tsx").then((m) => ({ default: m.ComputerPanel })),
);

// xterm.js loads with the first terminal opened, not with the panel.
export const TerminalView = late(() => import("./panel/TerminalView.tsx"));

// Computer use shows only in the desktop app; a contact's chat brings the channel's conversation and card.
export const ScreenLive = late(() => import("./chat/ScreenLive.tsx").then((m) => ({ default: m.ScreenLive })));
export const ComputerNotice = late(() =>
  import("./computers/ComputerNotice.tsx").then((m) => ({ default: m.ComputerNotice })),
);
export const ComputerProgress = late(() =>
  import("./computers/ComputerProgress.tsx").then((m) => ({ default: m.ComputerProgress })),
);
export const ContactChat = late(() => import("./channels/ContactChat.tsx").then((m) => ({ default: m.ContactChat })));
export const ActivityView = late(() => import("./inbox/ActivityView.tsx").then((m) => ({ default: m.ActivityView })));
export const ChannelFace = late(() => import("./inbox/ChannelFace.tsx").then((m) => ({ default: m.ChannelFace })));
export const ChannelTreeRow = late(() =>
  import("./inbox/ChannelTreeRow.tsx").then((m) => ({ default: m.ChannelTreeRow })),
);

// Message parts load with the first message that has one, not with the chat.
export const SurfacePart = late(() => import("./chat/parts/SurfacePart.tsx").then((m) => ({ default: m.SurfacePart })));
// A browser card shows only in a chat whose agent used a browser.
export const BrowserPart = late(() => import("./chat/parts/BrowserPart.tsx").then((m) => ({ default: m.BrowserPart })));
export const ChoicesPart = late(() => import("./chat/parts/ChoicesPart.tsx").then((m) => ({ default: m.ChoicesPart })));
export const ConnectPart = late(() => import("./chat/parts/ConnectPart.tsx").then((m) => ({ default: m.ConnectPart })));
export const MediaGroup = late(() => import("./chat/parts/MediaGroup.tsx"));
export const InputPart = late(() => import("./chat/parts/InputPart.tsx").then((m) => ({ default: m.InputPart })));

export const AudioPlayer = late(() => import("./chat/parts/AudioPart.tsx").then((m) => ({ default: m.AudioPart })));

export const DelegationActions = late(() =>
  import("./chat/parts/DelegationActions.tsx").then((m) => ({ default: m.DelegationActions })),
);
export const GoOn = late(() => import("./chat/parts/GoOn.tsx").then((m) => ({ default: m.GoOn })));

export const DocumentActions = late(() =>
  import("./panel/DocumentActions.tsx").then((m) => ({ default: m.DocumentActions })),
);

// The run button and its terminal load the first time a chat shows a shell block.
export const RunnableCode = late(() => import("./chat/RunnableCode.tsx").then((m) => ({ default: m.RunnableCode })));
export const ReceivedDialog = late(() =>
  import("./chat/ReceivedDialog.tsx").then((m) => ({ default: m.ReceivedDialog })),
);

// A model picker's list shows only once it opens (the composer has a picker).
export const ModelList = late(() => import("./config/models/ModelList.tsx").then((m) => ({ default: m.ModelList })));

// The editor and its languages load when the first text file opens.
export const CodeView = late(() => import("./project/files/CodeView.tsx").then((m) => ({ default: m.CodeView })));

// Flows: the list first, then a flow's runs and the editor (with the canvas library) only when opened.
export const FlowsScreen = late(() => import("./flows/FlowsScreen.tsx"));
export const FlowDetail = late(() => import("./flows/FlowDetail.tsx").then((m) => ({ default: m.FlowDetail })));
export const FlowEditor = late(() => import("./flows/FlowEditor.tsx").then((m) => ({ default: m.FlowEditor })));
// A project's tables, on the Flows screen's Tables.
export const TablesView = late(() => import("./flows/TablesView.tsx").then((m) => ({ default: m.TablesView })));
// A Flow an agent made or changed: its card in the chat draws it with the canvas library.
export const FlowCard = late(() => import("./flows/FlowCard.tsx").then((m) => ({ default: m.FlowCard })));
// Its drawing opened large, to look at each step.
export const FlowViewer = late(() => import("./flows/FlowViewer.tsx").then((m) => ({ default: m.FlowViewer })));

// The searchable picker (base-ui's combobox) loads after the first paint: the inbox's new-chat button has one.
export const SearchSelect = late(() =>
  import("./common/pickers/SearchSelect.tsx").then((m) => ({ default: m.SearchSelect })),
);

export const QrSvg = late(() => import("./common/QrSvg.tsx").then((m) => ({ default: m.QrSvg })));

// Plain modules loaded on first use.
export const loadOsNotices = () => import("./shell/osNotices.ts");
export const loadSounds = () => import("./shell/sounds.ts");
// The icons a project's tile can carry: only a project whose owner chose one asks for them.
export const loadProjectGlyphs = () => import("@colonia/ui/project-glyphs");
