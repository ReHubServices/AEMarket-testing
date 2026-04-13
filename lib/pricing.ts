export function normalizeMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function applyMarkup(price: number, markupPercent: number) {
  const multiplier = 1 + markupPercent / 100;
  return normalizeMoney(price * multiplier);
}
