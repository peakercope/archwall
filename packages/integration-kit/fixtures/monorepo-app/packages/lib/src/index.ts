export const formatMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
