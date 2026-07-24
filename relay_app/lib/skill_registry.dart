import 'relay_service.dart';
import 'deployment_service.dart';
import 'workspace_state.dart';

/// #1: Skills instead of Agents.
///
/// Each skill is a real function with a distinct job - not "pretend to be
/// a marketing agent," but an actual different code path. The router below
/// picks ONE skill per request instead of running the full fan-out/relay
/// every time, which is where most of the latency/cost/complexity in an
/// agent-swarm design comes from.
class SkillRegistry {
  final RelayService relayService;
  final DeploymentService deploymentService;

  SkillRegistry({required this.relayService, required this.deploymentService});

  /// Research: a single, direct model call - no need for the full
  /// fan-out/relay ceremony when the task is "look something up."
  Future<String> research(String query, {String contextBlock = ''}) async {
    final result = await relayService.run(query, contextBlock: contextBlock);
    return result.finalAnswer;
  }

  /// Build website: uses the full relay (fan-out -> synthesis -> relay)
  /// because "write good HTML" genuinely benefits from multiple takes -
  /// this is the kind of task the relay pipeline is actually suited for.
  Future<RelayResult> buildWebsite(String description, {String contextBlock = ''}) {
    final prompt = 'Generate a complete single-file HTML website for: $description';
    return relayService.run(prompt, contextBlock: contextBlock);
  }

  /// Write copy: direct call, no relay needed - copy is fast to judge,
  /// doesn't need multi-model debate to be usable.
  Future<String> writeCopy(String brief, {String contextBlock = ''}) async {
    final result = await relayService.run('Write marketing copy for: $brief', contextBlock: contextBlock);
    return result.finalAnswer;
  }

  /// Deploy: not an AI call at all - a direct action against real infra.
  Future<String> deploy(String projectName, String repoFullName) {
    return deploymentService.deployToVercel(projectName, repoFullName);
  }

  /// The router: decides which skill a prompt is asking for.
  /// Deliberately simple (keyword-based) - the whole point of this
  /// layer is to avoid an AI call just to decide "which AI call to make."
  String routeSkill(String prompt) {
    final p = prompt.toLowerCase();
    if (p.contains('deploy') || p.contains('publish') || p.contains('go live')) return 'deploy';
    if (p.contains('website') || p.contains('landing page') || p.contains('site')) return 'buildWebsite';
    if (p.contains('copy') || p.contains('marketing text') || p.contains('ad copy')) return 'writeCopy';
    return 'research'; // default: just answer the question
  }

  /// Builds the action cards to show under a response, based on
  /// workspace state - this is #4, every response pairs with a concrete
  /// next step derived from the gap, not a paragraph suggesting one.
  List<ActionCard> actionCardsFor(WorkspaceState state) {
    final cards = <ActionCard>[];
    if (state.gap.isNotEmpty) {
      cards.add(ActionCard(label: 'Work on ${state.gap.first.key}', skillName: 'buildWebsite'));
    }
    if (state.gap.isEmpty && state.deploymentStatus != 'live') {
      cards.add(ActionCard(label: 'Deploy', skillName: 'deploy'));
    }
    cards.add(ActionCard(label: 'Research', skillName: 'research'));
    return cards;
  }
}
