import type { Card, GapleConfig } from "./types";

/** 28 kartu double-six, urut kanonik. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) deck.push([a, b]);
  return deck;
}

export function cardPips(card: Card): number {
  return card[0] + card[1];
}

export function isDouble(card: Card): boolean {
  return card[0] === card[1];
}

export function sameCard(x: Card, y: Card): boolean {
  return x[0] === y[0] && x[1] === y[1];
}

export function canonical(card: Card): Card {
  return card[0] <= card[1] ? [card[0], card[1]] : [card[1], card[0]];
}

export function cardKey(card: Card): string {
  return `${card[0]}|${card[1]}`;
}

export function compareCards(x: Card, y: Card): number {
  return x[0] - y[0] || x[1] - y[1];
}

/** Titik sisa satu tangan, memakai aturan `zeroZeroPenalty`. */
export function handPoints(hand: readonly Card[], config: GapleConfig): number {
  let total = 0;
  for (const card of hand) {
    if (card[0] === 0 && card[1] === 0) {
      if (config.zeroZeroPenalty === 25) {
        const otherBlank = hand.some((c) => !(c[0] === 0 && c[1] === 0) && (c[0] === 0 || c[1] === 0));
        total += otherBlank ? 0 : 25;
      }
      continue;
    }
    total += cardPips(card);
  }
  return total;
}
