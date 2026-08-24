function localMonthKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
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
