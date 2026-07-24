import 'package:flutter/material.dart';
import 'relay_service.dart';
import 'settings_screen.dart';
import 'workspace.dart';
import 'workspace_state.dart';
import 'skill_registry.dart';
import 'deployment_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  runApp(const RelayApp());
}

class RelayApp extends StatelessWidget {
  const RelayApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Relay',
      theme: ThemeData(colorSchemeSeed: Colors.deepPurple, useMaterial3: true),
      home: const CeoDashboard(),
    );
  }
}

/// The CEO Dashboard: shows every workspace, its mission, and its gap -
/// computed directly from data you've entered. It does NOT invent
/// numbers, day-counts, or scores you haven't actually given it.
class CeoDashboard extends StatefulWidget {
  const CeoDashboard({super.key});

  @override
  State<CeoDashboard> createState() => _CeoDashboardState();
}

class _CeoDashboardState extends State<CeoDashboard> {
  WorkspaceManager? _manager;
  bool _useStub = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final manager = await WorkspaceManager.load();
    setState(() => _manager = manager);
  }

  @override
  Widget build(BuildContext context) {
    if (_manager == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Relay — Command Center'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen())),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          SwitchListTile(
            title: const Text('Stub mode (fake AI responses, no keys needed)'),
            value: _useStub,
            onChanged: (v) => setState(() => _useStub = v),
          ),
          const SizedBox(height: 8),
          ..._manager!.workspaces.map((ws) => _WorkspaceCard(
                workspace: ws,
                useStub: _useStub,
                onChanged: () async {
                  await _manager!.save();
                  setState(() {});
                },
              )),
        ],
      ),
    );
  }
}

class _WorkspaceCard extends StatefulWidget {
  final Workspace workspace;
  final bool useStub;
  final VoidCallback onChanged;

  const _WorkspaceCard({required this.workspace, required this.useStub, required this.onChanged});

  @override
  State<_WorkspaceCard> createState() => _WorkspaceCardState();
}

class _WorkspaceCardState extends State<_WorkspaceCard> {
  WorkspaceState _state = WorkspaceState();
  bool _expanded = false;
  bool _loading = false;
  String? _lastOutput;
  final _promptController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _state = WorkspaceState(mission: widget.workspace.name);
  }

  Future<void> _runSkill(String skillName) async {
    setState(() => _loading = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final keys = ApiKeys(
        anthropicKey: prefs.getString('anthropic_key'),
        openAiKey: prefs.getString('openai_key'),
        geminiKey: prefs.getString('gemini_key'),
      );
      final relay = RelayService(keys: keys, useStub: widget.useStub);
      final deploy = DeploymentService(
        githubToken: prefs.getString('github_token'),
        vercelToken: prefs.getString('vercel_token'),
      );
      final skills = SkillRegistry(relayService: relay, deploymentService: deploy);
      final contextBlock = widget.workspace.memory.buildContextBlock();
      final prompt = _promptController.text.trim().isEmpty
          ? 'General update for ${widget.workspace.name}'
          : _promptController.text.trim();

      String output;
      switch (skillName) {
        case 'buildWebsite':
          final result = await skills.buildWebsite(prompt, contextBlock: contextBlock);
          output = result.finalAnswer;
          break;
        case 'writeCopy':
          output = await skills.writeCopy(prompt, contextBlock: contextBlock);
          break;
        case 'research':
        default:
          output = await skills.research(prompt, contextBlock: contextBlock);
      }

      widget.workspace.memory.addConversation(prompt, output);
      setState(() => _lastOutput = output);
      widget.onChanged();
    } catch (e) {
      setState(() => _lastOutput = 'Error: $e');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final gap = _state.gap;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(widget.workspace.name,
                      style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ),
                IconButton(
                  icon: Icon(_expanded ? Icons.expand_less : Icons.expand_more),
                  onPressed: () => setState(() => _expanded = !_expanded),
                ),
              ],
            ),
            Text(
              gap.isEmpty
                  ? 'No progress data entered yet — add component progress to see gap analysis.'
                  : 'Biggest blocker: ${gap.first.key} (${gap.first.value}% complete)',
              style: TextStyle(color: Colors.grey[700]),
            ),
            if (_expanded) ...[
              const Divider(),
              TextField(
                controller: _promptController,
                decoration: const InputDecoration(labelText: 'Prompt for this workspace'),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: [
                  ElevatedButton(
                    onPressed: _loading ? null : () => _runSkill('research'),
                    child: const Text('Research'),
                  ),
                  ElevatedButton(
                    onPressed: _loading ? null : () => _runSkill('buildWebsite'),
                    child: const Text('Build Website'),
                  ),
                  ElevatedButton(
                    onPressed: _loading ? null : () => _runSkill('writeCopy'),
                    child: const Text('Write Copy'),
                  ),
                ],
              ),
              if (_loading) const Padding(padding: EdgeInsets.all(8), child: LinearProgressIndicator()),
              if (_lastOutput != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(_lastOutput!),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
