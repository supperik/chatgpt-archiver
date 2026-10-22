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

export const FILE_DOWNLOAD_REQUEST = {
  path(fileId: string): string {
    return `/backend-api/files/download/${fileId}`;
  },
  targetRoute: "/backend-api/files/download/{file_id}",
  buildQuery(chatId: string): Record<string, string> {
    return { conversation_id: chatId, inline: "false" };
  },
};

export const INTERPRETER_DOWNLOAD_REQUEST = {
  path(chatId: string): string {
    return `/backend-api/conversation/${chatId}/interpreter/download`;
  },
  targetRoute: "/backend-api/conversation/{conversation_id}/interpreter/download",
  buildQuery(messageId: string, sandboxPath: string): Record<string, string> {
    return { message_id: messageId, sandbox_path: sandboxPath };
  },
};
