export function formatCount(value: number): string {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (safeValue < 10000) return String(safeValue);

  const tenThousands = Math.floor(safeValue / 1000) / 10;
  return `${Number.isInteger(tenThousands) ? tenThousands : tenThousands.toFixed(1)}万`;
}
