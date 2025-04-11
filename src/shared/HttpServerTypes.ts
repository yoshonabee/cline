export interface HttpServerConfig {
	enabled: boolean
	port: number
	authRequired: boolean
}

export interface JwtPayload {
	userId: string
	timestamp: number
	exp: number
}

export interface AuthTokenResponse {
	token: string
	expiresAt: number
}

export interface TaskCreationRequest {
	text: string
	images?: string[]
}

export interface TaskCreationResponse {
	taskId: string
	status: "created"
}

export interface ToolExecutionRequest {
	tool: string
	params: Record<string, any>
}

export interface ToolExecutionResponse {
	result: any
	status: "success" | "error"
	error?: string
}

export interface TaskStatusResponse {
	taskId: string
	status: "running" | "completed" | "error"
	messages?: any[]
	error?: string
}

// Chat-related types
export interface ChatMessage {
	type: "user" | "assistant"
	content: string
	timestamp: string
	images?: string[]
	complete?: boolean
}

export interface ChatSession {
	id: string
	messages: ChatMessage[]
	status: "active" | "completed" | "error"
	createdAt: string
	updatedAt: string
}

export interface CreateChatRequest {
	text: string
	images?: string[]
}

export interface CreateChatResponse {
	sessionId: string
	status: "created"
}

export interface ChatMessageRequest {
	text: string
	images?: string[]
}

export interface ChatMessageResponse {
	sessionId: string
	message: ChatMessage
}

export interface ChatSessionResponse {
	session: ChatSession
}

export interface ChatStatusResponse {
	status: "active" | "completed" | "error"
	lastMessage?: ChatMessage
}
