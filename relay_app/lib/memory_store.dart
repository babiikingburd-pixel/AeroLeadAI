import 'db_helper.dart';

/// A single project Relay knows about (TapMe, AeroLead, Dial-A-Trade, etc).
class ProjectMemory {
  String name;
  String status; // e.g. "active", "paused", "launch phase"
  String notes;

  ProjectMemory({required this.name, this.status = 'active', this.notes = ''});

  Map<String, dynamic> toJson() => {'name': name, 'status': status, 'notes': notes};
  factory ProjectMemory.fromJson(Map<String, dynamic> j) =>
      ProjectMemory(name: j['name'], status: j['status'] ?? 'active', notes: j['notes'] ?? '');
}

/// One past exchange - kept short (prompt + final answer only, not the
/// full trace) so context stays lean when injected into future calls.
class ConversationMemory {
  final String prompt;
  final String finalAnswer;
  final DateTime timestamp;

  ConversationMemory({required this.prompt, required this.finalAnswer, required this.timestamp});

  Map<String, dynamic> toJson() =>
      {'prompt': prompt, 'finalAnswer': finalAnswer, 'timestamp': timestamp.toIso8601String()};
  factory ConversationMemory.fromJson(Map<String, dynamic> j) => ConversationMemory(
        prompt: j['prompt'],
        finalAnswer: j['finalAnswer'],
        timestamp: DateTime.parse(j['timestamp']),
      );
}

/// The full memory store: profile, projects, goals, and recent conversation
/// history. Everything lives in the on-device SQLite DB (via DBHelper),
/// scoped by workspaceId. This is what turns Relay from "starts at zero
/// every time" into something that knows what you're working on.
class MemoryStore {
  final String workspaceId;
  String currentFocus;
  List<ProjectMemory> projects;
  List<String> goals;
  List<ConversationMemory> recentConversations;

  static const _maxConversationsKept = 20; // cap so context doesn't grow forever

  MemoryStore({
    this.workspaceId = '',
    this.currentFocus = '',
    List<ProjectMemory>? projects,
    List<String>? goals,
    List<ConversationMemory>? recentConversations,
  })  : projects = projects ?? [],
        goals = goals ?? [],
        recentConversations = recentConversations ?? [];

  static Future<MemoryStore> load(String workspaceId) async {
    final currentFocus = await DBHelper.getCurrentFocus(workspaceId) ?? '';
    final projectRows = await DBHelper.getProjects(workspaceId);
    final goals = await DBHelper.getGoals(workspaceId);
    final convoRows = await DBHelper.getRecentConversations(workspaceId);

    return MemoryStore(
      workspaceId: workspaceId,
      currentFocus: currentFocus,
      projects: projectRows
          .map((p) => ProjectMemory(
                name: p['name'] as String,
                status: p['status'] as String,
                notes: p['notes'] as String,
              ))
          .toList(),
      goals: goals,
      // Rows are role+content pairs (user, then assistant), newest-first.
      // Reverse to chronological order and walk in twos to rebuild exchanges.
      recentConversations: _pairConversationRows(convoRows),
    );
  }

  static List<ConversationMemory> _pairConversationRows(List<Map<String, dynamic>> rows) {
    final chronological = rows.reversed.toList();
    final result = <ConversationMemory>[];
    for (var i = 0; i + 1 < chronological.length; i += 2) {
      final userRow = chronological[i];
      final assistantRow = chronological[i + 1];
      result.add(ConversationMemory(
        prompt: userRow['content'] as String,
        finalAnswer: assistantRow['content'] as String,
        timestamp: DateTime.fromMillisecondsSinceEpoch((assistantRow['created_at'] as int) * 1000),
      ));
    }
    return result;
  }

  Future<void> save() async {
    await DBHelper.setCurrentFocus(workspaceId, currentFocus);
    await DBHelper.replaceProjects(
      workspaceId,
      projects.map((p) => {'name': p.name, 'status': p.status, 'notes': p.notes}).toList(),
    );
    await DBHelper.replaceGoals(workspaceId, goals);
    // recentConversations are persisted incrementally by addConversation(),
    // not bulk-replaced here -- DBHelper.saveConversation() already caps
    // the table at 20 rows per workspace on insert (10 exchanges, since
    // each exchange is 2 rows -- see addConversation below).
  }

  void addConversation(String prompt, String finalAnswer) {
    recentConversations.add(ConversationMemory(prompt: prompt, finalAnswer: finalAnswer, timestamp: DateTime.now()));
    if (recentConversations.length > _maxConversationsKept) {
      recentConversations = recentConversations.sublist(recentConversations.length - _maxConversationsKept);
    }
    if (workspaceId.isNotEmpty) {
      // Fire-and-forget: keeps this method synchronous/void like before,
      // so call sites (e.g. main.dart) don't need to change. Stored as two
      // rows (user prompt, assistant answer) to match the conversations
      // table's role+content shape, which local_server.dart's /messages
      // endpoint also writes to.
      DBHelper.saveConversation(workspaceId, 'user', prompt).then((_) {
        DBHelper.saveConversation(workspaceId, 'assistant', finalAnswer);
      });
    }
  }

  /// Builds the block of text injected ahead of every prompt sent to the
  /// models, so each call has your current context without you retyping it.
  String buildContextBlock() {
    final buffer = StringBuffer();
    if (currentFocus.isNotEmpty) {
      buffer.writeln('Current focus: $currentFocus');
    }
    if (projects.isNotEmpty) {
      buffer.writeln('Active projects:');
      for (final p in projects) {
        buffer.writeln('- ${p.name} (${p.status})${p.notes.isNotEmpty ? ': ${p.notes}' : ''}');
      }
    }
    if (goals.isNotEmpty) {
      buffer.writeln('Goals:');
      for (final g in goals) {
        buffer.writeln('- $g');
      }
    }
    if (recentConversations.isNotEmpty) {
      buffer.writeln('Recent conversation history:');
      for (final c in recentConversations.reversed.take(5)) {
        buffer.writeln('- Q: ${c.prompt}\n  A: ${c.finalAnswer}');
      }
    }
    return buffer.toString();
  }
}
