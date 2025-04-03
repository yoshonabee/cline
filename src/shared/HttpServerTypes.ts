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
