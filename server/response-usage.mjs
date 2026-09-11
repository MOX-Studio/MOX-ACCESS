import { StringDecoder } from 'node:string_decoder';

export const modeFromTier = tier => tier === 'default' ? 'standard' : ['fast', 'priority'].includes(tier) ? 'fast' : null;
export const requestedModeFromTier = tier => tier == null || tier === 'default' ? 'standard' : ['fast','priority'].includes(tier) ? 'fast' : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

// Observe metadata only. Never retain prompts, tool arguments or answer content.
export function createUsageObserver() {
  const decoder = new StringDecoder('utf8');
  let pending = '', final = null, parseFailed = false;
  function consume(text) {
    pending = (pending + text).replace(/\r\n/g, '\n');
    let boundary;
    while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { parseFailed = true; continue; }
      if (!['response.completed', 'response.failed', 'response.incomplete'].includes(event.type)) continue;
      const response = event.response || {};
      const usage = response.usage || {};
      final = {
        responseId: typeof response.id === 'string' ? response.id : null,
        outcome: event.type === 'response.completed' ? 'completed' : event.type === 'response.failed' ? 'failed' : 'incomplete',
        inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens),
        cachedInputTokens: count(usage.input_tokens_details?.cached_tokens),
        reasoningOutputTokens: count(usage.output_tokens_details?.reasoning_tokens),
        effectiveTier: typeof response.service_tier === 'string' ? response.service_tier : null,
        effectiveMode: modeFromTier(response.service_tier)
      };
    }
    // A malformed/unbounded event must not retain arbitrary response content.
    if (pending.length > 8 * 1024 * 1024) { pending = ''; parseFailed = true; }
  }
  return {
    push(chunk) { consume(decoder.write(chunk)); },
    finish() {
      consume(decoder.end());
      if (pending.trim()) consume('\n\n');
      return { ...(final || { responseId: null, outcome: 'unknown', inputTokens: null, outputTokens: null, effectiveTier: null, effectiveMode: null }), parseFailed };
    }
  };
}
