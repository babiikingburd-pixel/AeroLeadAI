/// #2 + #3 + #7 combined: Mission, State, and the Gap->Action logic.
///
/// The key idea: progress lives in DATA, not in AI memory. The AI reads
/// this object and proposes the next action - it doesn't have to
/// remember or re-derive "where are we" from conversation history.
class WorkspaceState {
  String mission; // e.g. "Launch TapMe"
  Map<String, int> componentProgress; // e.g. {"website": 80, "mobile_app": 20, "marketing": 0}
  String deploymentStatus; // "pending", "live", "failed"

  WorkspaceState({
    this.mission = '',
    Map<String, int>? componentProgress,
    this.deploymentStatus = 'pending',
  }) : componentProgress = componentProgress ?? {};

  Map<String, dynamic> toJson() => {
        'mission': mission,
        'componentProgress': componentProgress,
        'deploymentStatus': deploymentStatus,
      };

  factory WorkspaceState.fromJson(Map<String, dynamic> j) => WorkspaceState(
        mission: j['mission'] ?? '',
        componentProgress: Map<String, int>.from(j['componentProgress'] ?? {}),
        deploymentStatus: j['deploymentStatus'] ?? 'pending',
      );

  /// The gap: which components are incomplete, sorted lowest-progress-first
  /// (the thing furthest behind is usually the real next action).
  List<MapEntry<String, int>> get gap {
    final incomplete = componentProgress.entries.where((e) => e.value < 100).toList();
    incomplete.sort((a, b) => a.value.compareTo(b.value));
    return incomplete;
  }

  /// The single suggested next action, derived from data - no AI call needed
  /// to figure out "what should I do next."
  String get suggestedNextAction {
    if (gap.isEmpty) {
      return deploymentStatus == 'live' ? 'Mission complete - nothing pending.' : 'All components done - deploy.';
    }
    final furthest = gap.first;
    return 'Work on "${furthest.key}" (${furthest.value}% complete)';
  }
}

/// An action card - a concrete, single button the UI can render.
/// #4: every response should be able to end in one of these, not just prose.
class ActionCard {
  final String label; // "Deploy", "Generate Site", "Research"
  final String skillName; // maps to a SkillRegistry function

  ActionCard({required this.label, required this.skillName});
}
