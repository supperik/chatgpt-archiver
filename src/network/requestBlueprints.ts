export const REQUIRED_CAPTURE_HEADERS = [
  "authorization",
  "chatgpt-account-id",
  "oai-client-build-number",
  "oai-client-version",
  "oai-device-id",
  "oai-language",
  "oai-session-id",
] as const;

export const CAPTURE_SOURCE_PATHS = [
  "/backend-api/conversations",
  "/backend-api/gizmos/snorlax/sidebar",
  "/backend-api/me",
] as const;

export const NON_PROJECT_CHATS_REQUEST = {
  path: "/backend-api/conversations",
  targetRoute: "/backend-api/conversations",
  buildQuery(offset: number, limit: number): Record<string, string> {
    return {
      offset: String(offset),
      limit: String(limit),
      order: "updated",
      is_archived: "false",
      is_starred: "false",
    };
  },
};

export const PROJECT_SIDEBAR_REQUEST = {
  path: "/backend-api/gizmos/snorlax/sidebar",
  targetRoute: "/backend-api/gizmos/snorlax/sidebar",
  buildQuery(projectLimit: number, conversationsPerGizmo: number): Record<string, string> {
    return {
      owned_only: "true",
      limit: String(projectLimit),
      conversations_per_gizmo: String(conversationsPerGizmo),
    };
  },
};

export const CHAT_MESSAGES_REQUEST = {
  path(chatId: string): string {
    return `/backend-api/conversation/${chatId}`;
  },
  targetRoute: "/backend-api/conversation/{conversation_id}",
};
