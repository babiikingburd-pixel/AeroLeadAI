import 'db_helper.dart';
import 'memory_store.dart';

/// One agent role assigned within a workspace (#2/#8 combined).
/// Each agent is really just a labeled instruction template applied
/// during the relay's synthesis/relay steps - "Developer Agent" means
/// "when you improve this draft, reason like a developer reviewing code."
class AgentRole {
  String name; // e.g. "Chief of Staff", "Research Agent", "Developer Agent"
  String instructionTemplate; // what gets injected as this agent's lens

  AgentRole({required this.name, required this.instructionTemplate});

  Map<String, dynamic> toJson() => {'name': name, 'instructionTemplate': instructionTemplate};
  factory AgentRole.fromJson(Map<String, dynamic> j) =>
      AgentRole(name: j['name'], instructionTemplate: j['instructionTemplate']);
}

/// A single workspace = its own memory + its own agent roster.
/// This is what lets "TapMe Workspace" and "AeroLead Workspace" not
/// bleed context into each other.
class Workspace {
  String id;
  String name; // "TapMe", "AeroLead AI", "Dial-A-Trade"
  MemoryStore memory;
  List<AgentRole> agents;

  Workspace({required this.id, required this.name, required this.memory, List<AgentRole>? agents})
      : agents = agents ?? _defaultAgents();

  static List<AgentRole> _defaultAgents() => [
        AgentRole(
          name: 'Chief of Staff',
          instructionTemplate: 'Prioritize clarity and next actions. Cut anything not decision-relevant.',
        ),
        AgentRole(
          name: 'Research Agent',
          instructionTemplate: 'Focus on facts, sources, and what is actually known vs assumed.',
        ),
        AgentRole(
          name: 'Developer Agent',
          instructionTemplate: 'Focus on technical correctness, edge cases, and what would actually run.',
        ),
      ];

  // NOTE: agent_roles in the SQLite schema only stores role_name + active
  // (no instructionTemplate column), so agent roles are not DB-persisted --
  // they stay as in-memory defaults, same as before this migration. There
  // was never a UI to edit them, so this preserves current behavior exactly.

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'memory': {
          'currentFocus': memory.currentFocus,
          'projects': memory.projects.map((p) => p.toJson()).toList(),
          'goals': memory.goals,
          'recentConversations': memory.recentConversations.map((c) => c.toJson()).toList(),
        },
        'agents': agents.map((a) => a.toJson()).toList(),
      };

  factory Workspace.fromJson(Map<String, dynamic> j) => Workspace(
        id: j['id'],
        name: j['name'],
        memory: MemoryStore(
          workspaceId: j['id'],
          currentFocus: j['memory']['currentFocus'] ?? '',
          projects: (j['memory']['projects'] as List? ?? []).map((p) => ProjectMemory.fromJson(p)).toList(),
          goals: List<String>.from(j['memory']['goals'] ?? []),
          recentConversations: (j['memory']['recentConversations'] as List? ?? [])
              .map((c) => ConversationMemory.fromJson(c))
              .toList(),
        ),
        agents: (j['agents'] as List? ?? []).map((a) => AgentRole.fromJson(a)).toList(),
      );
}

/// Manages the full list of workspaces, persisted locally via SQLite
/// (DBHelper) instead of SharedPreferences.
class WorkspaceManager {
  List<Workspace> workspaces;

  WorkspaceManager({List<Workspace>? workspaces}) : workspaces = workspaces ?? [];

  static Future<WorkspaceManager> load() async {
    // The workspaces table is seeded with TapMe / AeroLead AI / Dial-A-Trade
    // by db_helper.dart's onCreate, so this always has rows -- no more
    // "seed on first run" special-casing needed like the old prefs version.
    final rows = await DBHelper.getWorkspaces();
    final workspaces = <Workspace>[];
    for (final row in rows) {
      final id = row['id'] as String;
      final name = row['name'] as String;
      final memory = await MemoryStore.load(id);
      workspaces.add(Workspace(id: id, name: name, memory: memory));
    }
    return WorkspaceManager(workspaces: workspaces);
  }

  Future<void> save() async {
    for (final ws in workspaces) {
      await ws.memory.save();
    }
  }

  Workspace? byId(String id) {
    try {
      return workspaces.firstWhere((w) => w.id == id);
    } catch (_) {
      return null;
    }
  }
}
