/**
 * Anthropic Messages API ↔ OpenAI Chat Completions 포맷 변환
 *
 * Claude Code CLI가 Anthropic Messages API 포맷으로 요청을 보내면
 * OpenAI 호환 백엔드(vLLM, Ollama 등)로 변환하여 전달하고,
 * 응답을 다시 Anthropic 포맷으로 변환하여 반환한다.
 */

// ============================================
// Types
// ============================================

/** Anthropic content block types */
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | AnthropicThinkingBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicToolChoice {
  type: 'auto' | 'any' | 'tool';
  name?: string;
  disable_parallel_tool_use?: boolean;
}

/** OpenAI types */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ============================================
// Request: Anthropic → OpenAI
// ============================================

/**
 * Anthropic system prompt → OpenAI system message
 */
function convertSystemPrompt(
  system: string | AnthropicContentBlock[] | undefined,
): OpenAIMessage | null {
  if (!system) return null;

  if (typeof system === 'string') {
    return { role: 'system', content: system };
  }

  // Array of content blocks → concatenate text
  const textParts = system
    .filter((b): b is AnthropicTextBlock => b.type === 'text')
    .map((b) => b.text);

  if (textParts.length === 0) return null;
  return { role: 'system', content: textParts.join('\n\n') };
}

/**
 * Single Anthropic content block → OpenAI content part
 */
function convertContentBlock(block: AnthropicContentBlock): OpenAIContentPart | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };

    case 'image': {
      if (block.source.type === 'base64' && block.source.data) {
        const mediaType = block.source.media_type || 'image/png';
        return {
          type: 'image_url',
          image_url: { url: `data:${mediaType};base64,${block.source.data}` },
        };
      }
      if (block.source.type === 'url' && block.source.url) {
        return {
          type: 'image_url',
          image_url: { url: block.source.url },
        };
      }
      return null;
    }

    case 'thinking':
      // Thinking blocks → include as text with marker (open-source LLMs won't use native thinking)
      return { type: 'text', text: `<thinking>${block.thinking}</thinking>` };

    default:
      return null;
  }
}

/**
 * Anthropic messages → OpenAI messages
 *
 * Handles:
 * - Simple string content
 * - Content block arrays (text, image, tool_use, tool_result)
 * - tool_use in assistant messages → tool_calls
 * - tool_result in user messages → tool role messages
 */
export function convertAnthropicMessages(
  system: string | AnthropicContentBlock[] | undefined,
  messages: AnthropicMessage[],
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  // System prompt
  const systemMsg = convertSystemPrompt(system);
  if (systemMsg) result.push(systemMsg);

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      result.push(...convertAssistantMessage(msg));
    } else if (msg.role === 'user') {
      result.push(...convertUserMessage(msg));
    }
  }

  return result;
}

/**
 * Convert assistant message (may contain tool_use blocks)
 */
function convertAssistantMessage(msg: AnthropicMessage): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'assistant', content: msg.content }];
  }

  const blocks = msg.content;
  const toolUseBlocks = blocks.filter(
    (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
  );
  const otherBlocks = blocks.filter((b) => b.type !== 'tool_use');

  // Build content from non-tool blocks
  let content: string | null = null;
  if (otherBlocks.length > 0) {
    const textParts = otherBlocks
      .map(convertContentBlock)
      .filter((p): p is OpenAIContentPart => p !== null && p.type === 'text')
      .map((p) => p.text!);
    if (textParts.length > 0) content = textParts.join('');
  }

  // Convert tool_use blocks to tool_calls
  if (toolUseBlocks.length > 0) {
    const toolCalls: OpenAIToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id,
      type: 'function' as const,
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input),
      },
    }));

    return [{ role: 'assistant', content, tool_calls: toolCalls }];
  }

  return [{ role: 'assistant', content }];
}

/**
 * Convert user message (may contain tool_result blocks)
 */
function convertUserMessage(msg: AnthropicMessage): OpenAIMessage[] {
  if (typeof msg.content === 'string') {
    return [{ role: 'user', content: msg.content }];
  }

  const blocks = msg.content;
  const toolResults = blocks.filter(
    (b): b is AnthropicToolResultBlock => b.type === 'tool_result',
  );
  const otherBlocks = blocks.filter((b) => b.type !== 'tool_result');

  const result: OpenAIMessage[] = [];

  // tool_result blocks → individual tool role messages
  for (const tr of toolResults) {
    let content = '';
    if (typeof tr.content === 'string') {
      content = tr.content;
    } else if (Array.isArray(tr.content)) {
      content = tr.content
        .filter((b): b is AnthropicTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    }
    if (tr.is_error) {
      content = `[Error] ${content}`;
    }
    result.push({ role: 'tool', content, tool_call_id: tr.tool_use_id });
  }

  // Other blocks → user message
  if (otherBlocks.length > 0) {
    const parts = otherBlocks
      .map(convertContentBlock)
      .filter((p): p is OpenAIContentPart => p !== null);

    if (parts.length === 1 && parts[0]!.type === 'text') {
      result.push({ role: 'user', content: parts[0]!.text });
    } else if (parts.length > 0) {
      result.push({ role: 'user', content: parts });
    }
  }

  return result;
}

/**
 * Anthropic tools → OpenAI tools
 */
export function convertAnthropicTools(tools: AnthropicTool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Anthropic tool_choice → OpenAI tool_choice
 */
export function convertAnthropicToolChoice(
  tc: AnthropicToolChoice,
): string | { type: 'function'; function: { name: string } } {
  switch (tc.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: tc.name! } };
    default:
      return 'auto';
  }
}

// ============================================
// Response: OpenAI → Anthropic (non-streaming)
// ============================================

/**
 * Map OpenAI finish_reason to Anthropic stop_reason
 */
function mapStopReason(
  finishReason: string | null,
): 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null {
  switch (finishReason) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'tool_calls':
      return 'tool_use';
    case 'content_filter':
      return 'end_turn';
    default:
      return finishReason ? 'end_turn' : null;
  }
}

/**
 * Convert OpenAI non-streaming response → Anthropic Messages response
 */
export function convertOpenAIResponseToAnthropic(
  openAIResponse: any,
  requestModel: string,
): Record<string, unknown> {
  const choice = openAIResponse.choices?.[0];
  const message = choice?.message;

  const content: AnthropicContentBlock[] = [];

  // Text content
  if (message?.content) {
    content.push({ type: 'text', text: message.content });
  }

  // Tool calls
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = { _raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  // If no content at all, add empty text
  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    id: `msg_${openAIResponse.id || Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model: requestModel,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: openAIResponse.usage?.prompt_tokens || 0,
      output_tokens: openAIResponse.usage?.completion_tokens || 0,
    },
  };
}

// ============================================
// Response: OpenAI → Anthropic (streaming)
// ============================================

/**
 * Streaming state tracker for OpenAI → Anthropic SSE translation
 */
export interface AnthropicStreamState {
  messageStartSent: boolean;
  contentBlockIndex: number;
  currentBlockType: 'text' | 'tool_use' | null;
  toolCallBuffers: Map<number, { id: string; name: string; arguments: string }>;
  inputTokens: number;
  outputTokens: number;
  messageId: string;
  requestModel: string;
  finishReason: string | null;
}

export function createStreamState(requestModel: string): AnthropicStreamState {
  return {
    messageStartSent: false,
    contentBlockIndex: 0,
    currentBlockType: null,
    toolCallBuffers: new Map(),
    inputTokens: 0,
    outputTokens: 0,
    messageId: `msg_proxy_${Date.now()}`,
    requestModel,
    finishReason: null,
  };
}

/**
 * Format a single Anthropic SSE event
 */
function sseEvent(eventType: string, data: Record<string, unknown>): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Generate message_start event
 */
function messageStartEvent(state: AnthropicStreamState): string {
  return sseEvent('message_start', {
    type: 'message_start',
    message: {
      id: state.messageId,
      type: 'message',
      role: 'assistant',
      content: [],
      model: state.requestModel,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: state.inputTokens, output_tokens: 0 },
    },
  });
}

/**
 * Convert a single OpenAI SSE chunk to Anthropic SSE events
 * Returns array of formatted SSE strings to write
 */
export function convertOpenAIChunkToAnthropic(
  parsed: any,
  state: AnthropicStreamState,
): string[] {
  const events: string[] = [];

  // Send message_start if not yet sent
  if (!state.messageStartSent) {
    // Try to extract usage from first chunk
    if (parsed.usage) {
      state.inputTokens = parsed.usage.prompt_tokens || 0;
    }
    events.push(messageStartEvent(state));
    events.push(sseEvent('ping', { type: 'ping' }));
    state.messageStartSent = true;
  }

  const choice = parsed.choices?.[0];
  if (!choice) {
    // Usage-only chunk (stream_options: include_usage)
    if (parsed.usage) {
      state.inputTokens = parsed.usage.prompt_tokens || state.inputTokens;
      state.outputTokens = parsed.usage.completion_tokens || state.outputTokens;
    }
    return events;
  }

  const delta = choice.delta;
  if (!delta) return events;

  // ── Text content delta ──
  if (delta.content != null) {
    // Start text block if needed
    if (state.currentBlockType !== 'text') {
      // Close previous block
      if (state.currentBlockType !== null) {
        events.push(
          sseEvent('content_block_stop', {
            type: 'content_block_stop',
            index: state.contentBlockIndex,
          }),
        );
        state.contentBlockIndex++;
      }
      // Start text block
      events.push(
        sseEvent('content_block_start', {
          type: 'content_block_start',
          index: state.contentBlockIndex,
          content_block: { type: 'text', text: '' },
        }),
      );
      state.currentBlockType = 'text';
    }

    // Text delta
    if (delta.content.length > 0) {
      events.push(
        sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: state.contentBlockIndex,
          delta: { type: 'text_delta', text: delta.content },
        }),
      );
    }
  }

  // ── Tool call deltas ──
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      const tcIndex = tc.index ?? 0;

      if (tc.id || tc.function?.name) {
        // New tool call starting — close current block first
        if (state.currentBlockType !== null) {
          events.push(
            sseEvent('content_block_stop', {
              type: 'content_block_stop',
              index: state.contentBlockIndex,
            }),
          );
          state.contentBlockIndex++;
        }

        // Initialize buffer
        state.toolCallBuffers.set(tcIndex, {
          id: tc.id || `call_${Date.now()}_${tcIndex}`,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        });

        const buf = state.toolCallBuffers.get(tcIndex)!;
        // Start tool_use block
        events.push(
          sseEvent('content_block_start', {
            type: 'content_block_start',
            index: state.contentBlockIndex,
            content_block: { type: 'tool_use', id: buf.id, name: buf.name, input: '' },
          }),
        );
        state.currentBlockType = 'tool_use';

        // Send initial arguments if present
        if (buf.arguments.length > 0) {
          events.push(
            sseEvent('content_block_delta', {
              type: 'content_block_delta',
              index: state.contentBlockIndex,
              delta: { type: 'input_json_delta', partial_json: buf.arguments },
            }),
          );
        }
      } else if (tc.function?.arguments) {
        // Continuation of tool call arguments
        const buf = state.toolCallBuffers.get(tcIndex);
        if (buf) {
          buf.arguments += tc.function.arguments;
          events.push(
            sseEvent('content_block_delta', {
              type: 'content_block_delta',
              index: state.contentBlockIndex,
              delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
            }),
          );
        }
      }
    }
  }

  // ── Finish reason ──
  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }

  // ── Usage in chunk ──
  if (parsed.usage) {
    state.inputTokens = parsed.usage.prompt_tokens || state.inputTokens;
    state.outputTokens = parsed.usage.completion_tokens || state.outputTokens;
  }

  return events;
}

/**
 * Generate final Anthropic SSE events (content_block_stop, message_delta, message_stop)
 */
export function finalizeAnthropicStream(state: AnthropicStreamState): string[] {
  const events: string[] = [];

  // Close current content block
  if (state.currentBlockType !== null) {
    events.push(
      sseEvent('content_block_stop', {
        type: 'content_block_stop',
        index: state.contentBlockIndex,
      }),
    );
  }

  // message_delta with stop_reason and final usage
  events.push(
    sseEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: mapStopReason(state.finishReason),
        stop_sequence: null,
      },
      usage: { output_tokens: state.outputTokens },
    }),
  );

  // message_stop
  events.push(sseEvent('message_stop', { type: 'message_stop' }));

  return events;
}

/**
 * Convert Anthropic error to Anthropic API error response format
 */
export function anthropicError(
  status: number,
  type: string,
  message: string,
): { status: number; body: Record<string, unknown> } {
  return {
    status,
    body: {
      type: 'error',
      error: { type, message },
    },
  };
}
