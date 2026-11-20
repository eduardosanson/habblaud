// Leitura do `agy -p "/usage" --output-format json`: grupos Gemini / Claude-GPT / Argon e as piores janelas.
import { describe, expect, it } from 'vitest';
import { parseAntigravityUsage } from './events';

const RAW = {
  command: {
    name: 'usage',
    data: {
      groups: [
        {
          name: 'Gemini Models',
          buckets: [
            { window: 'weekly', remaining_fraction: 1, reset_time: '2026-11-25T01:48:24Z' },
            { window: '5h', remaining_fraction: 1, reset_time: '2026-11-20T09:43:22Z' },
          ],
        },
        {
          name: 'Claude and GPT models',
          buckets: [
            { window: 'weekly', remaining_fraction: 0.95, reset_time: '2026-11-25T01:48:43Z' },
            { window: '5h', remaining_fraction: 1, reset_time: '2026-11-20T09:43:22Z' },
          ],
        },
        {
          name: 'Gemini 4 Argon',
          buckets: [{ window: 'weekly', remaining_fraction: 0.14, reset_time: '2026-11-24T23:40:01Z' }],
        },
      ],
    },
  },
};

describe('parseAntigravityUsage', () => {
  const NOW = Date.parse('2026-11-20T01:50:00Z');

  it('mapeia os grupos, usa a pior janela no cartão e guarda os detalhes', () => {
    const usage = parseAntigravityUsage(RAW, NOW)!;
    // Pior 5 h: as duas em 100% restante -> 0% usado.
    expect(usage.fiveHour).toEqual({ utilization: 0, resetsAt: Date.parse('2026-11-20T09:43:22Z') });
    // Pior semana: Argon com 14% restante -> 86% usado.
    expect(usage.sevenDay).toEqual({ utilization: 86, resetsAt: Date.parse('2026-11-24T23:40:01Z') });
    expect(usage.details).toHaveLength(5);
    expect(usage.details).toContainEqual({ label: 'Gemini 4 Argon · semana', utilization: 86, resetsAt: Date.parse('2026-11-24T23:40:01Z') });
    expect(usage.source).toBe('antigravity');
    expect(usage.fetchedAt).toBe(NOW);
  });

  it('sem grupos ou sem frações: indefinido', () => {
    expect(parseAntigravityUsage({}, NOW)).toBeUndefined();
    expect(parseAntigravityUsage({ command: { data: { groups: [{ name: 'X', buckets: [] }] } } }, NOW)).toBeUndefined();
    expect(parseAntigravityUsage(null, NOW)).toBeUndefined();
  });
});
