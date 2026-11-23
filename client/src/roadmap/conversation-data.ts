// Sugestões de pergunta para a gaveta de conversa. A pergunta vai para o agente real que trabalhou no plano, então as
// sugestões são perguntas sobre o plano, não comandos para mover o roadmap.
import { tr } from '../../../shared/i18n';
import { planById, type ConversationContext } from './data';

export function suggestedQuestions(context: ConversationContext): string[] {
  if (context.kind !== 'plan' || !context.id) return [];
  const plan = planById(context.roadmapId, context.id);
  if (!plan) return [];
  const suggestions = [
    tr('Como ficou o {0}?', [plan.id]),
    tr('O que falta para concluir o {0}?', [plan.id]),
    tr('Quais arquivos você mudou no {0}?', [plan.id]),
  ];
  if (plan.status === 'blocked') suggestions.push(tr('O que está bloqueando o {0}?', [plan.id]));
  return suggestions;
}
