import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Keys are stored in shared_preferences - local to the device, plaintext.
/// Note: for stronger protection (phone lost/stolen), swap this for the
/// flutter_secure_storage package later - same API shape, encrypted storage.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _anthropicController = TextEditingController();
  final _openAiController = TextEditingController();
  final _geminiController = TextEditingController();
  final _githubTokenController = TextEditingController();
  final _vercelTokenController = TextEditingController();
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    _anthropicController.text = prefs.getString('anthropic_key') ?? '';
    _openAiController.text = prefs.getString('openai_key') ?? '';
    _geminiController.text = prefs.getString('gemini_key') ?? '';
    _githubTokenController.text = prefs.getString('github_token') ?? '';
    _vercelTokenController.text = prefs.getString('vercel_token') ?? '';
    setState(() => _loaded = true);
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('anthropic_key', _anthropicController.text.trim());
    await prefs.setString('openai_key', _openAiController.text.trim());
    await prefs.setString('gemini_key', _geminiController.text.trim());
    await prefs.setString('github_token', _githubTokenController.text.trim());
    await prefs.setString('vercel_token', _vercelTokenController.text.trim());
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Keys saved on this device.')),
      );
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('API Keys')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            const Text(
              'Keys are stored only on this device. Leave the stub mode ON '
              'in the main screen until you\'ve added the keys you plan to use.',
              style: TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _anthropicController,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Anthropic (Claude) API key'),
            ),
            TextField(
              controller: _openAiController,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'OpenAI (GPT-4o) API key'),
            ),
            TextField(
              controller: _geminiController,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Google (Gemini) API key'),
            ),
            const SizedBox(height: 24),
            const Divider(),
            const SizedBox(height: 8),
            const Text(
              'Deploy accounts (for the Deploy button). Generate a GitHub token '
              'at github.com/settings/tokens with "repo" scope, and a Vercel '
              'token at vercel.com/account/tokens. Your Vercel account must '
              'already be connected to your GitHub account (one-time setup on '
              'vercel.com) before deploys will work.',
              style: TextStyle(color: Colors.grey),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _githubTokenController,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'GitHub personal access token'),
            ),
            TextField(
              controller: _vercelTokenController,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Vercel API token'),
            ),
            const SizedBox(height: 24),
            ElevatedButton(onPressed: _save, child: const Text('Save')),
          ],
        ),
      ),
    );
  }
}
