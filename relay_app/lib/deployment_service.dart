import 'dart:convert';
import 'package:http/http.dart' as http;

/// #10: Deployment automation.
///
/// This is real, working API code — but it can only ever go as far as
/// your own accounts let it. I can write the calls; I can't create a
/// GitHub account or a Vercel account for you, or hold your tokens
/// server-side securely without a server. On a phone app, these tokens
/// live in local storage same as the model API keys — same tradeoff
/// as before (lost phone = exposed tokens unless you add
/// flutter_secure_storage later).
class DeploymentService {
  final String? githubToken;
  final String? vercelToken;

  DeploymentService({this.githubToken, this.vercelToken});

  /// Creates a new GitHub repo and pushes initial files to it.
  /// Returns the repo URL.
  Future<String> createGithubRepo(String repoName, Map<String, String> files) async {
    if (githubToken == null || githubToken!.isEmpty) {
      throw Exception('No GitHub token set. Generate one at github.com/settings/tokens with "repo" scope.');
    }

    // 1. Create the repo
    final createResp = await http.post(
      Uri.parse('https://api.github.com/user/repos'),
      headers: {
        'Authorization': 'Bearer $githubToken',
        'Accept': 'application/vnd.github+json',
      },
      body: jsonEncode({'name': repoName, 'private': false, 'auto_init': true}),
    );
    if (createResp.statusCode != 201) {
      throw Exception('GitHub repo creation failed (${createResp.statusCode}): ${createResp.body}');
    }
    final repoData = jsonDecode(createResp.body);
    final owner = repoData['owner']['login'];
    final repoUrl = repoData['html_url'];

    // 2. Push each file via the Contents API (simple approach - one commit per file)
    for (final entry in files.entries) {
      final path = entry.key;
      final content = base64Encode(utf8.encode(entry.value));
      final putResp = await http.put(
        Uri.parse('https://api.github.com/repos/$owner/$repoName/contents/$path'),
        headers: {
          'Authorization': 'Bearer $githubToken',
          'Accept': 'application/vnd.github+json',
        },
        body: jsonEncode({'message': 'Add $path', 'content': content}),
      );
      if (putResp.statusCode != 201 && putResp.statusCode != 200) {
        throw Exception('Failed to push $path (${putResp.statusCode}): ${putResp.body}');
      }
    }

    return repoUrl;
  }

  /// Triggers a Vercel deployment from a GitHub repo. Returns the live URL.
  /// Requires the repo to already exist (run createGithubRepo first) and
  /// your Vercel account to already be linked to your GitHub account
  /// (one-time setup on vercel.com, not something an API call can do).
  Future<String> deployToVercel(String projectName, String githubRepoFullName) async {
    if (vercelToken == null || vercelToken!.isEmpty) {
      throw Exception('No Vercel token set. Generate one at vercel.com/account/tokens.');
    }

    final resp = await http.post(
      Uri.parse('https://api.vercel.com/v13/deployments'),
      headers: {
        'Authorization': 'Bearer $vercelToken',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({
        'name': projectName,
        'gitSource': {
          'type': 'github',
          'repo': githubRepoFullName, // e.g. "yourname/repo-name"
          'ref': 'main',
        },
      }),
    );
    if (resp.statusCode != 200 && resp.statusCode != 201) {
      throw Exception('Vercel deployment failed (${resp.statusCode}): ${resp.body}');
    }
    final data = jsonDecode(resp.body);
    return 'https://${data['url']}';
  }
}
