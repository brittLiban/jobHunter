const DAILY_VOLUME_WINDOW_MS = 24 * 60 * 60 * 1000;

export function getDailyVolumeWindowStart(now = new Date()) {
  return new Date(now.getTime() - DAILY_VOLUME_WINDOW_MS);
}

export function isWithinDailyVolumeWindow(
  timestamp: Date | string | null | undefined,
  now = new Date(),
) {
  if (!timestamp) {
    return false;
  }

  const value = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return false;
  }

  return value >= getDailyVolumeWindowStart(now);
}
