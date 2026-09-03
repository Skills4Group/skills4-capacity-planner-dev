export function localMonthKey(date: Date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

function offsetMonthKey(date: Date, amount: number) {
  return localMonthKey(new Date(date.getFullYear(), date.getMonth() + amount, 1))
}

export function selectMonthOptions(
  forecastMonths: string[],
  priorMonths: number = 3,
  now: Date = new Date(),
) {
  const earliestMonth = offsetMonthKey(now, -Math.max(0, priorMonths))
  return forecastMonths.filter((month) => month >= earliestMonth)
}

export function defaultForecastMonth(
  forecastMonths: string[],
  now: Date = new Date(),
) {
  const currentMonth = localMonthKey(now)
  return forecastMonths.find((month) => month >= currentMonth)
    ?? forecastMonths.at(-1)
    ?? ''
}

export function selectRollingMonths(
  forecastMonths: string[],
  horizon: number,
  now: Date = new Date(),
) {
  const currentMonth = localMonthKey(now)
  return forecastMonths
    .filter((month) => month >= currentMonth)
    .slice(0, horizon)
}
