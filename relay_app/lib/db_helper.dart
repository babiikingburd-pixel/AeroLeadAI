// lib/db_helper.dart
// Add sqflite + path to pubspec.yaml:
//   sqflite: ^2.3.0
//   path: ^1.9.0

import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

class DBHelper {
  static Database? _db;

  static Future<Database> get database async {
    if (_db != null) return _db!;
    _db = await _initDB();
    return _db!;
  }

  static Future<Database> _initDB() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, 'relay.db');

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        // Paste full contents of relay_schema.sql here as one batch,
        // or load it from an asset file at build time.
        final batch = db.batch();
        for (final stmt in _schemaStatements) {
          batch.execute(stmt);
        }
        await batch.commit(noResult: true);
      },
    );
  }

  // Example query methods --------------------------------------------

  static Future<void> saveConversation(
      String workspaceId, String role, String content) async {
    final db = await database;
    await db.insert('conversations', {
      'workspace_id': workspaceId,
      'role': role,
      'content': content,
      'created_at': DateTime.now().millisecondsSinceEpoch ~/ 1000,
    });

    // Enforce cap of 20 recent conversations per workspace
    final rows = await db.query(
      'conversations',
      where: 'workspace_id = ?',
      whereArgs: [workspaceId],
      orderBy: 'created_at DESC',
    );
    if (rows.length > 20) {
      final toDelete = rows.skip(20).map((r) => r['id']).toList();
      for (final id in toDelete) {
        await db.delete('conversations', where: 'id = ?', whereArgs: [id]);
      }
    }
  }

  static Future<List<Map<String, dynamic>>> getRecentConversations(
      String workspaceId) async {
    final db = await database;
    return db.query(
      'conversations',
      where: 'workspace_id = ?',
      whereArgs: [workspaceId],
      orderBy: 'created_at DESC',
      limit: 20,
    );
  }

  static Future<void> updateComponentProgress(
      String workspaceId, String component, int pct) async {
    final db = await database;
    await db.insert(
      'component_progress',
      {
        'workspace_id': workspaceId,
        'component_name': component,
        'progress_pct': pct,
        'updated_at': DateTime.now().millisecondsSinceEpoch ~/ 1000,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  static Future<Map<String, int>> getComponentProgress(
      String workspaceId) async {
    final db = await database;
    final rows = await db.query(
      'component_progress',
      where: 'workspace_id = ?',
      whereArgs: [workspaceId],
    );
    return {
      for (final r in rows)
        r['component_name'] as String: r['progress_pct'] as int
    };
  }

  static Future<void> saveRelayRun(String workspaceId, Map<String, dynamic> run) async {
    final db = await database;
    await db.insert('relay_runs', {
      'workspace_id': workspaceId,
      ...run,
      'created_at': DateTime.now().millisecondsSinceEpoch ~/ 1000,
    });
  }

  // Generic key/value storage (backs the `settings` table) - used to swap
  // out whole-object SharedPreferences blobs (memory_store, workspaces)
  // for SQLite without redesigning their JSON shape.
  static Future<String?> getSetting(String key) async {
    final db = await database;
    final rows = await db.query('settings', where: 'key = ?', whereArgs: [key], limit: 1);
    if (rows.isEmpty) return null;
    return rows.first['value'] as String?;
  }

  static Future<void> setSetting(String key, String value) async {
    final db = await database;
    await db.insert(
      'settings',
      {
        'key': key,
        'value': value,
        'updated_at': DateTime.now().millisecondsSinceEpoch ~/ 1000,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }
}

// Full schema, split into individual executable statements.
// Generated from relay_schema.sql — keep both files in sync.
const List<String> _schemaStatements = [
  '''CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )''',
  '''CREATE TABLE workspace_state (
    workspace_id TEXT PRIMARY KEY,
    mission TEXT,
    deployment_status TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE component_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    component_name TEXT NOT NULL,
    progress_pct INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    UNIQUE(workspace_id, component_name)
  )''',
  '''CREATE TABLE current_focus (
    workspace_id TEXT PRIMARY KEY,
    focus_text TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE project_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    goal_text TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  'CREATE INDEX idx_conversations_workspace_time ON conversations(workspace_id, created_at DESC)',
  '''CREATE TABLE agent_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    role_name TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE relay_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    claude_raw TEXT,
    gpt4o_raw TEXT,
    gemini_raw TEXT,
    synthesis_draft TEXT,
    relay_hop_1 TEXT,
    relay_hop_2 TEXT,
    relay_hop_3 TEXT,
    final_answer TEXT,
    stub_mode INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE skill_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    input_text TEXT,
    output_text TEXT,
    success INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    repo_or_url TEXT,
    status TEXT,
    raw_response TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  )''',
  '''CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
  )''',
  '''INSERT INTO workspaces (id, name, created_at, updated_at) VALUES
    ('tapme', 'TapMe / 2UNE TAGS', strftime('%s','now'), strftime('%s','now')),
    ('aerolead', 'AeroLead AI', strftime('%s','now'), strftime('%s','now')),
    ('dialatrade', 'Dial-A-Trade', strftime('%s','now'), strftime('%s','now'))''',
  '''INSERT INTO workspace_state (workspace_id, mission, deployment_status, updated_at) VALUES
    ('tapme', 'Launch TapMe NFC keychain product', 'not_started', strftime('%s','now')),
    ('aerolead', 'Launch AeroLead AI roofing lead platform', 'not_started', strftime('%s','now')),
    ('dialatrade', 'Launch Dial-A-Trade dispatch platform', 'not_started', strftime('%s','now'))''',
];
