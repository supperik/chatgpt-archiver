import type { ProjectMetadata } from "../contracts";

const CHAT_URL_PATTERN = /\/c\/([a-z0-9-]+)/i;
const PROJECT_URL_PATTERN = /\/g\/([^/?#]+)\/project(?:[/?#]|$)/i;
const PROJECT_SCOPE_URL_PATTERN =
  /\/g\/([^/?#]+)(?:\/project(?:[/?#]|$)|\/c\/[a-z0-9-]+(?:[/?#]|$))/i;

export function getChatIdFromUrl(url: string): string | null {
  return CHAT_URL_PATTERN.exec(url)?.[1] ?? null;
}

export function getProjectIdFromUrl(url: string): string | null {
  const projectId = PROJECT_SCOPE_URL_PATTERN.exec(url)?.[1] ?? null;
  return projectId && projectId.toLowerCase().startsWith("g-p-") ? projectId : null;
}

export function getProjectPageIdFromUrl(url: string): string | null {
  const projectId = PROJECT_URL_PATTERN.exec(url)?.[1] ?? null;
  return projectId && projectId.toLowerCase().startsWith("g-p-") ? projectId : null;
}

export function isProjectUrl(url: string): boolean {
  return getProjectPageIdFromUrl(url) !== null;
}

export function getProjectNameFromProjectId(projectId: string): string | null {
  const slug = /^g-p-[^-]+-(.+)$/i.exec(projectId)?.[1] ?? null;
  if (!slug) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(slug);
    const humanized = decoded.replace(/[-_]+/g, " ").trim();
    return humanized || null;
  } catch {
    const humanized = slug.replace(/[-_]+/g, " ").trim();
    return humanized || null;
  }
}

export function resolveProjectMetadata(
  url: string,
  preferred?: ProjectMetadata,
): Required<Pick<ProjectMetadata, "projectId" | "projectName">> | null {
  const projectId = preferred?.projectId ?? getProjectIdFromUrl(url);
  if (!projectId) {
    return null;
  }

  const projectName = preferred?.projectName?.trim() || getProjectNameFromProjectId(projectId) || projectId;
  return {
    projectId,
    projectName,
  };
}
