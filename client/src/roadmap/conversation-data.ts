// Sugestões de conversa e tradução do histórico do Hermes Pipeline para as mensagens
// exibidas na gaveta. Não existe resposta roteirizada: o texto vem do agente.
import { tr } from '../../../shared/i18n';
import {
  defaultPlanFor,
  planById,
  roadmapById,
  roadmapPlans,
  type ConversationContext,
  type Plan,
} from './data';
import { formatDateTime } from './live';
import type { ApiMessage } from './pipeline';
import type { ActionReceipt, ChatMessage } from './state';

function receipt(action: ApiMessage['actions'][number]): ActionReceipt {
  return {
    id: action.id,
    action: action.action,
    status: action.status,
    target: action.target,
    summary: action.summary,
    revision: action.revision,
    ...(action.error ? { error: action.error } : {}),
  };
}

export function mapMessages(messages: ApiMessage[], session: { agentId: string } | undefined): ChatMessage[] {
  const mapped: ChatMessage[] = messages.map((message) => {
    const plan = message.context?.itemId && message.context.roadmapId
      ? planById(message.context.roadmapId, message.context.itemId)
      : undefined;
    return {
      id: message.id,
      messageId: message.messageId,
      role: message.role,
      ...(message.role === 'agent' && session ? { agentId: session.agentId } : {}),
      text: message.text,
      at: formatDateTime(message.receivedAt),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.status ? { state: message.status } : {}),
      ...(plan ? { planRef: { roadmapId: plan.roadmapId, planId: plan.id } } : {}),
      ...(message.actions?.length ? { actions: message.actions.map(receipt) } : {}),
    };
  });

  // O histórico do pipeline anexa os recibos à mensagem do usuário. Na tela eles
  // aparecem junto da resposta do agente, que é o efeito observável da ação.
  const replyByUser = new Map(
    mapped.filter((message) => message.role === 'agent' && message.replyTo).map((message) => [message.replyTo!, message]),
  );
  for (const message of mapped) {
    if (message.role !== 'user' || !message.actions?.length) continue;
    const reply = replyByUser.get(message.messageId);
    if (reply) {
      reply.actions = [...(reply.actions ?? []), ...message.actions];
      if (message.planRef && !reply.planRef) reply.planRef = message.planRef;
      message.actions = undefined;
    }
  }
  return mapped;
}

function commandFor(plan: Plan): string {
  if (plan.pipelineStatus === 'blocked') return tr('Desbloqueie o {0}', [plan.id]);
  if (plan.pipelineStatus === 'ready') return tr('Mova o {0} para andamento', [plan.id]);
  if (plan.pipelineStatus === 'backlog') return tr('Mova o {0} para pronto', [plan.id]);
  if (plan.pipelineStatus === 'in_progress') return tr('Mova o {0} para revisão', [plan.id]);
  return tr('Estime o {0} em 20000 tokens', [plan.id]);
}

function contextPlan(context: ConversationContext): Plan | undefined {
  const roadmap = roadmapById(context.roadmapId);
  if (!roadmap) return undefined;
  if (context.kind === 'plan' && context.id) return planById(roadmap.id, context.id);
  if (context.kind === 'phase' && context.id) {
    const phase = roadmap.phases.find((candidate) => candidate.id === context.id || String(candidate.index) === context.id);
    return phase?.plans.find((plan) => plan.status === 'blocked') ?? phase?.plans.find((plan) => plan.status === 'active') ?? phase?.plans[0];
  }
  return undefined;
}

export function suggestedQuestions(context: ConversationContext): string[] {
  const roadmap = roadmapById(context.roadmapId);
  if (!roadmap) return [tr('Qual o progresso do roadmap?')];
  const plans = roadmapPlans(roadmap);
  const blocked = plans.find((plan) => plan.status === 'blocked');
  const active = plans.find((plan) => plan.status === 'active');
  const contextTarget = contextPlan(context);
  const target = contextTarget ?? active ?? blocked ?? plans.find((plan) => plan.status === 'future') ?? defaultPlanFor(roadmap);
  const suggestions = [
    tr('Qual o progresso do roadmap?'),
    commandFor(target),
    tr('Estime o {0} em 20000 tokens', [target.id]),
  ];
  if (blocked && blocked.id !== target.id) suggestions.push(tr('Desbloqueie o {0}', [blocked.id]));
  if (active && active.id !== target.id) suggestions.push(tr('Mova o {0} para revisão', [active.id]));
  return [...new Set(suggestions)].slice(0, 4);
}

