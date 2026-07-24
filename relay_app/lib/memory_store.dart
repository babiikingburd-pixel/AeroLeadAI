import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

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
/// history. Everything lives in shared_preferences (local to the device).
/// This is what turns Relay from "starts at zero every time" into
/// something that knows what you're working on.
class MemoryStore {
  String currentFocus;
  List<ProjectMemory> projects;
  List<String> goals;
  List<ConversationMemory> recentConversations;

  static const _maxConversationsKept = 20; // cap so context doesn't grow forever

  MemoryStore({
    this.currentFocus = '',
    List<ProjectMemory>? projects,
    List<String>? goals,
    List<ConversationMemory>? recentConversations,
  })  : projects = projects ?? [],
        goals = goals ?? [],
        recentConversations = recentConversations ?? [];

  static Future<MemoryStore> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString('memory_store');
    if (raw == null) return MemoryStore();
    final j = jsonDecode(raw);
    return MemoryStore(
      currentFocus: j['currentFocus'] ?? '',
      projects: (j['projects'] as List? ?? []).map((p) => ProjectMemory.fromJson(p)).toList(),
      goals: List<String>.from(j['goals'] ?? []),
      recentConversations: (j['recentConversations'] as List? ?? [])
          .map((c) => ConversationMemory.fromJson(c))
          .toList(),
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'memory_store',
      jsonEncode({
        'currentFocus': currentFocus,
        'projects': projects.map((p) => p.toJson()).toList(),
        'goals': goals,
        'recentConversations': recentConversations.map((c) => c.toJson()).toList(),
      }),
    );
  }

  void addConversation(String prompt, String finalAnswer) {
    recentConversations.add(ConversationMemory(prompt: prompt, finalAnswer: finalAnswer, timestamp: DateTime.now()));
    if (recentConversations.length > _maxConversationsKept) {
      recentConversations = recentConversations.sublist(recentConversations.length - _maxConversationsKept);
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
