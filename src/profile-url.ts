export const APP_HOME_PATH = "/app/bbs/home";
export const USER_PROFILE_HASH_PREFIX = "#/user/";

export function userProfileHash(userId: string): string {
  return `${USER_PROFILE_HASH_PREFIX}${encodeURIComponent(userId.trim())}`;
}

export function userProfilePath(userId: string): string {
  return `${APP_HOME_PATH}${userProfileHash(userId)}`;
}

export function userProfileUrl(userId: string): string {
  return `https://www.xiaoheihe.cn${userProfilePath(userId)}`;
}
