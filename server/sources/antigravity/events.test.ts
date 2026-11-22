// Leitura do `agy -p "/usage" --output-format json`: somente grupos Google (Gemini / Argon), ignorando terceiros.
import { describe, expect, it } from 'vitest';
import { isGoogleAntigravityGroup, parseAntigravityUsage } from './events';

const RAW = {
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.91, reset_time: '2026-11-25T01:48:24Z' },
            { id: 'gemini-5h', window: '5h', remaining_fraction: 0.95, reset_time: '2026-11-20T09:43:22Z' },
          ],
        },
        {
          name: 'Claude and GPT models',
          buckets: [
            { id: '3p-weekly', window: 'weekly', remaining_fraction: 0, reset_time: '2026-11-25T01:48:43Z' },
            { id: '3p-5h', window: '5h', disabled: true, remaining_fraction: 1 },
          ],
        },
        {
          name: 'Gemini 4 Argon',
          buckets: [{ id: 'gemini-argon-wtu-weekly', window: 'weekly', remaining_fraction: 0.14, reset_time: '2026-11-24T23:40:01Z' }],
        },
      ],
    },
  },
};

describe('parseAntigravityUsage', () => {
  const NOW = Date.parse('2026-11-20T01:50:00Z');

  it('filtra somente modelos Google, ordena 5 h antes de semana e exclui Claude/GPT', () => {
    const usage = parseAntigravityUsage(RAW, NOW)!;
    // Pior 5 h do Google: Gemini Models 5% usado (não inclui terceiros).
    expect(usage.fiveHour?.utilization).toBeCloseTo(5, 5);
    expect(usage.fiveHour?.resetsAt).toBe(Date.parse('2026-11-20T09:43:22Z'));
    // Pior semana do Google: Argon com 14% restante -> 86% usado (não 100% do Claude/GPT).
    expect(usage.sevenDay).toEqual({ utilization: 86, resetsAt: Date.parse('2026-11-24T23:40:01Z') });
    expect(usage.details).toHaveLength(3);
    expect(usage.details?.map((d) => [d.label, d.group, d.window])).toEqual([
      ['Gemini Models · 5 h', 'Gemini Models', '5h'],
      ['Gemini Models · semana', 'Gemini Models', 'weekly'],
      ['Gemini 4 Argon · semana', 'Gemini 4 Argon', 'weekly'],
    ]);
    expect(usage.details?.some((d) => /claude|gpt/i.test(d.label))).toBe(false);
    expect(usage.source).toBe('antigravity');
    expect(usage.fetchedAt).toBe(NOW);
  });

  it('suporta 4 limites do Google e ignora buckets disabled ou de terceiros', () => {
    const raw = {
      command: {
        data: {
          groups: [
            {
              name: 'Gemini Models',
              buckets: [
                { id: 'gemini-weekly', window: 'weekly', remaining_fraction: 0.9, reset_time: '2026-11-25T01:00:00Z' },
                { id: 'gemini-5h', window: '5h', remaining_fraction: 0.95, reset_time: '2026-11-20T09:00:00Z' },
              ],
            },
            {
              name: 'Claude and GPT models',
              buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 0, reset_time: '2026-11-25T01:00:00Z' }],
            },
            {
              name: 'Gemini 4 Argon',
              buckets: [
                { id: 'gemini-argon-weekly', window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-29T12:00:00Z' },
                { id: 'gemini-argon-5h', window: '5h', remaining_fraction: 0.8, reset_time: '2026-11-20T07:00:00Z' },
                { id: 'gemini-argon-off', window: 'monthly', disabled: true, remaining_fraction: 0 },
              ],
            },
          ],
        },
      },
    };
    const usage = parseAntigravityUsage(raw, NOW)!;
    expect(usage.fiveHour?.utilization).toBeCloseTo(20, 5);
    expect(usage.sevenDay?.utilization).toBeCloseTo(10, 5);
    expect(usage.details).toHaveLength(4);
    expect(usage.details?.map((d) => `${d.group}:${d.window}`)).toEqual([
      'Gemini Models:5h',
      'Gemini Models:weekly',
      'Gemini 4 Argon:5h',
      'Gemini 4 Argon:weekly',
    ]);
  });

  it('isGoogleAntigravityGroup distingue Google de terceiros', () => {
    expect(isGoogleAntigravityGroup('Gemini Models', 'gemini-weekly')).toBe(true);
    expect(isGoogleAntigravityGroup('Gemini 4 Argon', 'gemini-argon-wtu-weekly')).toBe(true);
    expect(isGoogleAntigravityGroup('Claude and GPT models', '3p-weekly')).toBe(false);
    expect(isGoogleAntigravityGroup('OpenAI Models')).toBe(false);
  });

  it('sem grupos Google ou sem frações: indefinido', () => {
    expect(parseAntigravityUsage({}, NOW)).toBeUndefined();
    expect(parseAntigravityUsage({ command: { data: { groups: [{ name: 'X', buckets: [] }] } } }, NOW)).toBeUndefined();
    expect(
      parseAntigravityUsage(
        { command: { data: { groups: [{ name: 'Claude and GPT models', buckets: [{ id: '3p-weekly', window: 'weekly', remaining_fraction: 0 }] }] } } },
        NOW,
      ),
    ).toBeUndefined();
    expect(parseAntigravityUsage(null, NOW)).toBeUndefined();
  });
});
