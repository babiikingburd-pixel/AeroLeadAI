// lib/local_server.dart
//
// Runs a real HTTP server INSIDE the Relay app, on the phone itself.
// No laptop, no external host — binds to localhost on the phone's own
// loopback interface. Backed by the same SQLite DB as db_helper.dart.
//
// Add to pubspec.yaml:
//   shelf: ^1.4.1
//   shelf_router: ^1.1.4
//
// Start it once from main.dart (see bottom of this file for the call).

import 'dart:convert';
import 'dart:io';
import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart' as shelf_io;
import 'package:shelf_router/shelf_router.dart';
import 'db_helper.dart';

class LocalServer {
  static const int port = 8787; // pick any free local port
  static HttpServer? _server;

  static Future<void> start() async {
    final router = Router();

    // GET /health — confirm the server's alive
    router.get('/health', (Request req) {
      return Response.ok(jsonEncode({'status': 'ok'}),
          headers: {'content-type': 'application/json'});
    });

    // GET /workspaces/<id>/context — full context block for a workspace
    router.get('/workspaces/<id>/context', (Request req, String id) async {
      final progress = await DBHelper.getComponentProgress(id);
      final convos = await DBHelper.getRecentConversations(id);
      final body = {
        'workspace_id': id,
        'component_progress': progress,
        'recent_conversations': convos,
      };
      return Response.ok(jsonEncode(body),
          headers: {'content-type': 'application/json'});
    });

    // POST /workspaces/<id>/messages — save a message (user or assistant)
    router.post('/workspaces/<id>/messages', (Request req, String id) async {
      final payload = jsonDecode(await req.readAsString());
      final role = payload['role'] as String;
      final content = payload['content'] as String;
      await DBHelper.saveConversation(id, role, content);
      return Response.ok(jsonEncode({'saved': true}),
          headers: {'content-type': 'application/json'});
    });

    // POST /workspaces/<id>/progress — update a component's progress %
    router.post('/workspaces/<id>/progress', (Request req, String id) async {
      final payload = jsonDecode(await req.readAsString());
      final component = payload['component'] as String;
      final pct = payload['pct'] as int;
      await DBHelper.updateComponentProgress(id, component, pct);
      return Response.ok(jsonEncode({'saved': true}),
          headers: {'content-type': 'application/json'});
    });

    // POST /relay-runs — log a full fan-out/synthesis/relay run
    router.post('/relay-runs', (Request req) async {
      final payload = jsonDecode(await req.readAsString());
      final workspaceId = payload['workspace_id'] as String;
      await DBHelper.saveRelayRun(workspaceId, payload);
      return Response.ok(jsonEncode({'saved': true}),
          headers: {'content-type': 'application/json'});
    });

    final handler =
        const Pipeline().addMiddleware(logRequests()).addHandler(router);

    // 127.0.0.1 = loopback only. Nothing outside the phone can reach this.
    _server = await shelf_io.serve(handler, '127.0.0.1', port);
    print('Local Relay server running at http://127.0.0.1:$port');
  }

  static Future<void> stop() async {
    await _server?.close(force: true);
    _server = null;
  }
}
