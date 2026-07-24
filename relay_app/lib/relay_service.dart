import 'dart:convert';
import 'package:http/http.dart' as http;

/// One step in the relay trace - lets the UI show exactly what happened
/// at each hop (fan-out, synthesis, relay, final).
class RelayStep {
  final String stepName;
  final String model;
  final String output;
  RelayStep({required this.stepName, required this.model, required this.output});
}

class RelayResult {
  final String finalAnswer;
  final List<RelayStep> trace;
  RelayResult({required this.finalAnswer, required this.trace});
}

/// Holds API keys - passed in from the settings screen, never hardcoded.
class ApiKeys {
  final String? anthropicKey;
  final String? openAiKey;
  final String? geminiKey;
  ApiKeys({this.anthropicKey, this.openAiKey, this.geminiKey});
}

class RelayService {
  final ApiKeys keys;
  final bool useStub; // true = fake responses (test the flow with no keys), false = real API calls

  RelayService({required this.keys, this.useStub = true});

  // Model roster for fan-out + relay. Reasoner is always Claude.
  static const modelNames = ['ModelA (Claude)', 'ModelB (GPT-4o)', 'ModelC (Gemini)'];
  static const reasonerName = 'Reasoner (Claude)';

  /// [contextBlock] is memory context (profile/projects/goals/history) -
  /// prepended to the prompt so every model call has it automatically.
  Future<RelayResult> run(String prompt, {String contextBlock = ''}) async {
    final trace = <RelayStep>[];
    final effectivePrompt = contextBlock.isEmpty ? prompt : '$contextBlock\n\nQuestion: $prompt';

    // ---------- STEP 1: FAN-OUT (parallel) ----------
    final rawAnswers = await Future.wait([
      _callModel(0, 'answer the original prompt', effectivePrompt),
      _callModel(1, 'answer the original prompt', effectivePrompt),
      _callModel(2, 'answer the original prompt', effectivePrompt),
    ]);
    for (var i = 0; i < modelNames.length; i++) {
      trace.add(RelayStep(stepName: 'fan-out', model: modelNames[i], output: rawAnswers[i]));
    }

    // ---------- STEP 2: SYNTHESIS ----------
    final synthesisInput = 'Original prompt: $prompt\n\nThree responses:\n' +
        List.generate(3, (i) => '${modelNames[i]}: ${rawAnswers[i]}').join('\n');
    final draftV1 = await _callReasoner('synthesize the 3 responses into one draft', synthesisInput);
    trace.add(RelayStep(stepName: 'synthesis', model: reasonerName, output: draftV1));

    // ---------- STEP 3: RELAY (sequential, no history - just current draft) ----------
    String currentDraft = draftV1;
    for (var i = 0; i < modelNames.length; i++) {
      currentDraft = await _callModel(i, 'improve this draft, no other context', currentDraft);
      trace.add(RelayStep(stepName: 'relay', model: modelNames[i], output: currentDraft));
    }

    // ---------- STEP 4: FINAL PASS ----------
    final finalAnswer = await _callReasoner('produce the final answer from this relayed draft', currentDraft);
    trace.add(RelayStep(stepName: 'final', model: reasonerName, output: finalAnswer));

    return RelayResult(finalAnswer: finalAnswer, trace: trace);
  }

  // Routes to the right model by index (0=Claude, 1=GPT-4o, 2=Gemini).
  Future<String> _callModel(int index, String instruction, String input) async {
    if (useStub) return _stub(modelNames[index], instruction, input);
    switch (index) {
      case 0:
        return _callClaude(instruction, input);
      case 1:
        return _callOpenAI(instruction, input);
      case 2:
        return _callGemini(instruction, input);
      default:
        throw Exception('Unknown model index $index');
    }
  }

  Future<String> _callReasoner(String instruction, String input) async {
    if (useStub) return _stub(reasonerName, instruction, input);
    return _callClaude(instruction, input);
  }

  Future<String> _stub(String modelName, String instruction, String input) async {
    await Future.delayed(const Duration(milliseconds: 200));
    final snippet = input.length > 60 ? '${input.substring(0, 60)}...' : input;
    return '[$modelName response] Given "$snippet" — ($instruction) fake stubbed answer from $modelName.';
  }

  // ---------------- REAL API CALLS ----------------

  Future<String> _callClaude(String instruction, String input) async {
    if (keys.anthropicKey == null || keys.anthropicKey!.isEmpty) {
      throw Exception('No Anthropic API key set. Add it in Settings.');
    }
    final resp = await http.post(
      Uri.parse('https://api.anthropic.com/v1/messages'),
      headers: {
        'x-api-key': keys.anthropicKey!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'model': 'claude-sonnet-4-6',
        'max_tokens': 1000,
        'messages': [
          {'role': 'user', 'content': '$instruction\n\n$input'}
        ],
      }),
    );
    if (resp.statusCode != 200) {
      throw Exception('Claude API error ${resp.statusCode}: ${resp.body}');
    }
    final data = jsonDecode(resp.body);
    return data['content'][0]['text'] as String;
  }

  Future<String> _callOpenAI(String instruction, String input) async {
    if (keys.openAiKey == null || keys.openAiKey!.isEmpty) {
      throw Exception('No OpenAI API key set. Add it in Settings.');
    }
    final resp = await http.post(
      Uri.parse('https://api.openai.com/v1/chat/completions'),
      headers: {
        'Authorization': 'Bearer ${keys.openAiKey!}',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'model': 'gpt-4o',
        'messages': [
          {'role': 'user', 'content': '$instruction\n\n$input'}
        ],
      }),
    );
    if (resp.statusCode != 200) {
      throw Exception('OpenAI API error ${resp.statusCode}: ${resp.body}');
    }
    final data = jsonDecode(resp.body);
    return data['choices'][0]['message']['content'] as String;
  }

  Future<String> _callGemini(String instruction, String input) async {
    if (keys.geminiKey == null || keys.geminiKey!.isEmpty) {
      throw Exception('No Gemini API key set. Add it in Settings.');
    }
    final resp = await http.post(
      Uri.parse(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${keys.geminiKey}'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({
        'contents': [
          {
            'parts': [
              {'text': '$instruction\n\n$input'}
            ]
          }
        ],
      }),
    );
    if (resp.statusCode != 200) {
      throw Exception('Gemini API error ${resp.statusCode}: ${resp.body}');
    }
    final data = jsonDecode(resp.body);
    return data['candidates'][0]['content']['parts'][0]['text'] as String;
  }
}
