/**
 * Explanation Generator
 *
 * Calls GPT to generate human-friendly explanations from ranked results.
 * Falls back to machine reasons if the API call fails.
 *
 * GPT is ONLY used for explanation — it never recalculates or re-ranks.
 */

import type { RankedOffer, SearchContext, JourneyType, ExplanationOutput } from '../types';
import { buildExplanationMessages } from './buildExplanationPrompt';

/**
 * Generate a human-friendly explanation for a ranked offer using GPT.
 *
 * @param rankedOffer - The ranked offer to explain
 * @param searchContext - The search context
 * @param journeyType - domestic or international
 * @returns ExplanationOutput with headline, bullets, and optional tradeoff
 */
export async function explainRanking(
  rankedOffer: RankedOffer,
  searchContext: SearchContext,
  journeyType: JourneyType,
): Promise<ExplanationOutput> {
  try {
    const { system, user } = buildExplanationMessages(rankedOffer, searchContext, journeyType);

    // Attempt GPT call using the project's existing OpenAI SDK
    const OpenAI = await import('openai').then(m => m.default || m);
    const client = new OpenAI();

    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const content = response.choices?.[0]?.message?.content;
    if (content) {
      return parseExplanation(content, rankedOffer);
    }

    // Fallback if no content
    return buildFallbackExplanation(rankedOffer);
  } catch (error) {
    // Graceful fallback: use machine reasons directly
    console.warn('[Ranking] GPT explanation failed, using fallback:', (error as Error).message);
    return buildFallbackExplanation(rankedOffer);
  }
}

/**
 * Parse GPT response into structured ExplanationOutput.
 * Handles variations in GPT's formatting.
 */
function parseExplanation(content: string, rankedOffer: RankedOffer): ExplanationOutput {
  const lines = content.trim().split('\n').filter(l => l.trim().length > 0);

  let headline = '';
  const bullets: string[] = [];
  let tradeoffSentence: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect tradeoff lines
    if (trimmed.toLowerCase().startsWith('tradeoff') || trimmed.toLowerCase().startsWith('trade-off')) {
      tradeoffSentence = trimmed.replace(/^(tradeoff|trade-off):?\s*/i, '').trim();
      continue;
    }

    // Detect bullet points
    if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*') || /^\d+\./.test(trimmed)) {
      bullets.push(trimmed.replace(/^[-•*]\s*/, '').replace(/^\d+\.\s*/, '').trim());
      continue;
    }

    // First non-bullet line is the headline
    if (!headline && trimmed.length > 0) {
      headline = trimmed;
    }
  }

  // Ensure we have meaningful content
  if (!headline) {
    headline = `FareMind recommends this ${rankedOffer.airline} flight.`;
  }
  if (bullets.length === 0) {
    bullets.push(...rankedOffer.machineReasons.slice(0, 4));
  }

  return {
    headline,
    bullets: bullets.slice(0, 5),
    tradeoffSentence: tradeoffSentence || (rankedOffer.tradeoffs.length > 0
      ? rankedOffer.tradeoffs.join(' ')
      : undefined),
  };
}

/**
 * Build fallback explanation directly from machine reasons.
 * Used when GPT is unavailable or fails.
 */
function buildFallbackExplanation(rankedOffer: RankedOffer): ExplanationOutput {
  const headline = rankedOffer.rank === 1
    ? `FareMind recommends this ${rankedOffer.airline} flight as the best overall value.`
    : `This ${rankedOffer.airline} flight ranks #${rankedOffer.rank} overall.`;

  return {
    headline,
    bullets: rankedOffer.machineReasons.slice(0, 5),
    tradeoffSentence: rankedOffer.tradeoffs.length > 0
      ? rankedOffer.tradeoffs.join(' ')
      : undefined,
  };
}

/**
 * Generate explanations for the top N ranked offers.
 * Useful for explaining the top 3–5 recommendations.
 */
export async function explainTopOffers(
  rankedOffers: RankedOffer[],
  searchContext: SearchContext,
  journeyType: JourneyType,
  topN: number = 3,
): Promise<Map<string, ExplanationOutput>> {
  const results = new Map<string, ExplanationOutput>();
  const toExplain = rankedOffers.slice(0, topN);

  // Sequential to avoid rate limiting
  for (const offer of toExplain) {
    const explanation = await explainRanking(offer, searchContext, journeyType);
    results.set(offer.offerId, explanation);
  }

  return results;
}
