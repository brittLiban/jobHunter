import {
  getApplicationsForUser,
  getDashboardSnapshotForUser,
  getJobsForUser,
  getNotificationsForUser,
  getProfileBundle,
  listResumesForUser,
} from "@jobhunter/db";

export async function loadDashboardPageData(userId: string) {
  return getDashboardSnapshotForUser(userId);
}

export async function loadJobsPageData(userId: string) {
  return getJobsForUser(userId);
}

export async function loadApplicationsPageData(userId: string) {
  return getApplicationsForUser(userId);
}

export async function loadNotificationsPageData(userId: string) {
  return getNotificationsForUser(userId);
}

export async function loadProfilePageData(userId: string) {
  return getProfileBundle(userId);
}

export async function loadResumesPageData(userId: string) {
  return listResumesForUser(userId);
}
