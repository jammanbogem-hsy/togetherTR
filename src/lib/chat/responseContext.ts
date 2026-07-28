export function isStaleActivityResponse(
  requestedActivity: string,
  activeActivity: string,
  requestedCycle?: number,
  activeCycle?: number,
): boolean {
  return requestedActivity !== activeActivity
    || (
      requestedCycle !== undefined
      && activeCycle !== undefined
      && requestedCycle !== activeCycle
    )
}
