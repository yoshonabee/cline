import { Request, Response, Router } from "express"
import { AuthManager } from "./AuthManager"
import { Controller } from "../../core/controller"
import { WebviewProvider } from "../../core/webview"
import * as vscode from "vscode"
import {
	TaskCreationRequest,
	TaskCreationResponse,
	ToolExecutionRequest,
	ToolExecutionResponse,
	TaskStatusResponse,
	CreateChatRequest,
	CreateChatResponse,
	ChatMessageRequest,
	ChatMessageResponse,
	ChatSessionResponse,
	ChatStatusResponse,
	ChatSession,
	ChatMessage,
} from "../../shared/HttpServerTypes"
import { Logger } from "../../services/logging/Logger"
import { WebSocket } from "ws"

/**
 * Handles HTTP API requests and routes them to the appropriate controller methods.
 */
export class HttpController {
	private router: Router
	private chatSessions: Map<string, ChatSession> = new Map()
	private wsClients: Map<string, Set<WebSocket>> = new Map()

	constructor(
		private controllerRef: WeakRef<Controller>,
		private authManager: AuthManager,
	) {
		this.router = Router()
		this.setupRoutes()
	}

	/**
	 * Get the Express router with all API routes configured
	 */
	getRouter(): Router {
		return this.router
	}

	/**
	 * Configure all API routes
	 */
	private setupRoutes(): void {
		// Health check endpoint (no auth required)
		this.router.get("/api/status", this.getStatus.bind(this))

		// Generate token endpoint (only accessible from localhost)
		this.router.get("/api/token", this.generateToken.bind(this))

		// Chat endpoints
		this.router.post("/api/chat/sessions", this.authMiddleware.bind(this), this.createChatSession.bind(this))
		this.router.post(
			"/api/chat/sessions/:sessionId/messages",
			this.authMiddleware.bind(this),
			this.sendChatMessage.bind(this),
		)
		this.router.get("/api/chat/sessions/:sessionId", this.authMiddleware.bind(this), this.getChatSession.bind(this))
		this.router.get("/api/chat/sessions/:sessionId/status", this.authMiddleware.bind(this), this.getChatStatus.bind(this))

		// Existing endpoints
		this.router.post("/api/tasks", this.authMiddleware.bind(this), this.createTask.bind(this))
		this.router.post("/api/tools/execute", this.authMiddleware.bind(this), this.executeTools.bind(this))
		this.router.get("/api/tasks/:id", this.authMiddleware.bind(this), this.getTaskStatus.bind(this))
	}

	/**
	 * Authentication middleware that conditionally applies JWT authentication
	 */
	private authMiddleware(req: Request, res: Response, next: Function) {
		// Check if auth is required by configuration
		const controller = this.controllerRef.deref()
		if (!controller) {
			res.status(500).json({ error: "Controller not available" })
			return
		}

		// Get configuration and check if auth is required
		const config = vscode.workspace.getConfiguration("cline.http")
		const authRequired = config.get<boolean>("authRequired", true)

		if (authRequired) {
			// Use the auth manager middleware
			this.authManager.authMiddleware(req, res, next)
		} else {
			// Skip authentication
			next()
		}
	}

	/**
	 * Status endpoint to check if the server is running
	 */
	private getStatus(req: Request, res: Response) {
		const controller = this.controllerRef.deref()
		if (!controller) {
			res.status(500).json({ error: "Controller not available" })
			return
		}

		res.json({
			status: "ok",
			version: controller.context.extension?.packageJSON?.version || "unknown",
		})
	}

	/**
	 * Generate and return a new JWT token
	 * Only accessible from localhost for security
	 */
	private generateToken(req: Request, res: Response) {
		// Check if request is from localhost
		const ip = req.ip || req.socket.remoteAddress
		const isLocalhost = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1"

		if (!isLocalhost) {
			res.status(403).json({ error: "Token generation only allowed from localhost" })
			return
		}

		const tokenResponse = this.authManager.generateToken()
		res.json(tokenResponse)
	}

	/**
	 * Create a new task
	 */
	private async createTask(req: Request, res: Response): Promise<void> {
		try {
			const controller = this.controllerRef.deref()
			if (!controller) {
				res.status(500).json({ error: "Controller not available" })
				return
			}

			const taskRequest = req.body as TaskCreationRequest

			if (!taskRequest || !taskRequest.text) {
				res.status(400).json({ error: "Missing required field: text" })
				return
			}

			// Get a visible webview instance
			const visibleWebview = WebviewProvider.getVisibleInstance()
			if (!visibleWebview) {
				res.status(500).json({ error: "No visible Cline instance available" })
				return
			}

			// Initialize a task with the text
			await visibleWebview.controller.initClineWithTask(taskRequest.text, taskRequest.images)

			// We don't have direct access to taskId, so let's use task history to get the latest task
			const history = await controller.getStateToPostToWebview()
			const taskId = history.currentTaskItem?.id
			if (!taskId) {
				res.status(500).json({ error: "Failed to create task" })
				return
			}

			// Return the task ID
			const response: TaskCreationResponse = {
				taskId,
				status: "created",
			}

			Logger.log(`HTTP API: Created task ${taskId}`)
			res.status(201).json(response)
		} catch (error) {
			Logger.log(`HTTP API Error: ${error}`)
			res.status(500).json({ error: "Internal server error" })
		}
	}

	/**
	 * Execute a tool
	 */
	private async executeTools(req: Request, res: Response) {
		try {
			const controller = this.controllerRef.deref()
			if (!controller) {
				res.status(500).json({ error: "Controller not available" })
				return
			}

			const toolRequest = req.body as ToolExecutionRequest

			if (!toolRequest || !toolRequest.tool) {
				res.status(400).json({ error: "Missing required field: tool" })
				return
			}

			// Get a visible webview instance
			const visibleWebview = WebviewProvider.getVisibleInstance()
			if (!visibleWebview) {
				res.status(500).json({ error: "No visible Cline instance available" })
				return
			}

			// Ensure there is an active task by checking task history
			const history = await controller.getStateToPostToWebview()
			if (!history.currentTaskItem) {
				res.status(400).json({ error: "No active task" })
				return
			}

			// Execute the tool (simplified for now)
			// In a real implementation, this would execute the specific tool logic
			// For now, we'll just log the request and return success
			Logger.log(
				`HTTP API: Tool execution request - Tool: ${toolRequest.tool}, Params: ${JSON.stringify(toolRequest.params)}`,
			)

			const response: ToolExecutionResponse = {
				result: { message: "Tool execution not fully implemented yet" },
				status: "success",
			}

			res.json(response)
		} catch (error) {
			Logger.log(`HTTP API Error: ${error}`)
			res.status(500).json({
				status: "error",
				error: "Internal server error",
			})
		}
	}

	/**
	 * Get task status
	 */
	private async getTaskStatus(req: Request, res: Response) {
		try {
			const controller = this.controllerRef.deref()
			if (!controller) {
				res.status(500).json({ error: "Controller not available" })
				return
			}

			const taskId = req.params.id

			if (!taskId) {
				res.status(400).json({ error: "Missing task ID" })
				return
			}

			// Try to get task history
			try {
				const { historyItem } = await controller.getTaskWithId(taskId)

				const response: TaskStatusResponse = {
					taskId: historyItem.id,
					status: "completed",
					// We could add more detailed information here if needed
				}

				res.json(response)
			} catch (error) {
				// Task not found
				res.status(404).json({
					status: "error",
					error: "Task not found",
				})
			}
		} catch (error) {
			Logger.log(`HTTP API Error: ${error}`)
			res.status(500).json({
				status: "error",
				error: "Internal server error",
			})
		}
	}

	/**
	 * Create a new chat session
	 */
	private async createChatSession(req: Request, res: Response) {
		try {
			const controller = this.controllerRef.deref()
			if (!controller) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: Controller not available`)
				res.status(500).json({ error: "Controller not available" })
				return
			}

			const chatRequest = req.body as CreateChatRequest
			if (!chatRequest || !chatRequest.text) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: Missing required field: text`)
				res.status(400).json({ error: "Missing required field: text" })
				return
			}

			Logger.log(`[${new Date().toISOString()}] HTTP API: 收到新的聊天請求: ${chatRequest.text}`)

			// Get a visible webview instance
			const visibleWebview = WebviewProvider.getVisibleInstance()
			if (!visibleWebview) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: No visible Cline instance available`)
				res.status(500).json({ error: "No visible Cline instance available" })
				return
			}

			// Create a new session
			const sessionId = Math.random().toString(36).substring(2, 15)
			const now = new Date().toISOString()
			const session: ChatSession = {
				id: sessionId,
				messages: [],
				status: "active",
				createdAt: now,
				updatedAt: now,
			}

			// Add initial message
			const message: ChatMessage = {
				type: "user",
				content: chatRequest.text,
				timestamp: now,
				images: chatRequest.images,
			}
			session.messages.push(message)

			// Store the session
			this.chatSessions.set(sessionId, session)

			Logger.log(`[${new Date().toISOString()}] HTTP API: 創建新的聊天會話 ${sessionId}`)

			// 設置當前會話 ID 到 controller
			controller.setCurrentSessionId(sessionId)
			Logger.log(`[${new Date().toISOString()}] HTTP API: 已設置當前會話 ID 到 controller: ${sessionId}`)

			// Initialize task with the message
			await visibleWebview.controller.initClineWithTask(chatRequest.text, chatRequest.images)
			Logger.log(`[${new Date().toISOString()}] HTTP API: 已初始化任務: ${chatRequest.text}`)

			const response: CreateChatResponse = {
				sessionId,
				status: "created",
			}

			Logger.log(`[${new Date().toISOString()}] HTTP API: 聊天會話 ${sessionId} 創建成功`)
			res.status(201).json(response)
		} catch (error) {
			Logger.log(`[${new Date().toISOString()}] HTTP API Error: ${error}`)
			res.status(500).json({ error: "Internal server error" })
		}
	}

	/**
	 * Send a message in an existing chat session
	 */
	private async sendChatMessage(req: Request, res: Response) {
		try {
			const controller = this.controllerRef.deref()
			if (!controller) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: Controller not available`)
				res.status(500).json({ error: "Controller not available" })
				return
			}

			const sessionId = req.params.sessionId
			const messageRequest = req.body as ChatMessageRequest

			if (!messageRequest || !messageRequest.text) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: Missing required field: text`)
				res.status(400).json({ error: "Missing required field: text" })
				return
			}

			Logger.log(`[${new Date().toISOString()}] HTTP API: 收到會話 ${sessionId} 的新訊息: ${messageRequest.text}`)

			const session = this.chatSessions.get(sessionId)
			if (!session) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: Chat session ${sessionId} not found`)
				res.status(404).json({ error: "Chat session not found" })
				return
			}

			// Get a visible webview instance
			const visibleWebview = WebviewProvider.getVisibleInstance()
			if (!visibleWebview) {
				Logger.log(`[${new Date().toISOString()}] HTTP API Error: No visible Cline instance available`)
				res.status(500).json({ error: "No visible Cline instance available" })
				return
			}

			// 設置當前會話 ID 到 controller
			controller.setCurrentSessionId(sessionId)
			Logger.log(`[${new Date().toISOString()}] HTTP API: 已設置當前會話 ID 到 controller: ${sessionId}`)

			// Send message to the existing task
			await visibleWebview.controller.handleWebviewMessage({
				type: "newTask",
				text: messageRequest.text,
				images: messageRequest.images,
			})
			Logger.log(`[${new Date().toISOString()}] HTTP API: 已發送訊息到現有任務: ${messageRequest.text}`)

			// Add message to session
			const message: ChatMessage = {
				type: "user",
				content: messageRequest.text,
				timestamp: new Date().toISOString(),
				images: messageRequest.images,
			}
			session.messages.push(message)

			// Notify WebSocket clients
			const clients = this.wsClients.get(sessionId)
			if (clients) {
				const messageResponse: ChatMessageResponse = {
					sessionId,
					message,
				}
				clients.forEach((client) => {
					if (client.readyState === WebSocket.OPEN) {
						client.send(JSON.stringify(messageResponse))
						Logger.log(`[${new Date().toISOString()}] HTTP API: 已通過 WebSocket 發送訊息到客戶端`)
					}
				})
			}

			res.status(200).json({ status: "sent" })
		} catch (error) {
			Logger.log(`[${new Date().toISOString()}] HTTP API Error: ${error}`)
			res.status(500).json({ error: "Internal server error" })
		}
	}

	/**
	 * Get chat session details
	 */
	private async getChatSession(req: Request, res: Response) {
		try {
			const sessionId = req.params.sessionId
			const session = this.chatSessions.get(sessionId)

			if (!session) {
				res.status(404).json({ error: "Chat session not found" })
				return
			}

			const response: ChatSessionResponse = {
				session,
			}

			res.json(response)
		} catch (error) {
			Logger.log(`HTTP API Error: ${error}`)
			res.status(500).json({ error: "Internal server error" })
		}
	}

	/**
	 * Get chat session status
	 */
	private async getChatStatus(req: Request, res: Response) {
		try {
			const sessionId = req.params.sessionId
			const session = this.chatSessions.get(sessionId)

			if (!session) {
				res.status(404).json({ error: "Chat session not found" })
				return
			}

			const response: ChatStatusResponse = {
				status: session.status,
				lastMessage: session.messages[session.messages.length - 1],
			}

			res.json(response)
		} catch (error) {
			Logger.log(`HTTP API Error: ${error}`)
			res.status(500).json({ error: "Internal server error" })
		}
	}

	/**
	 * Handle WebSocket connection for a chat session
	 */
	handleWebSocket(ws: WebSocket, sessionId: string) {
		// Get or create client set for this session
		let clients = this.wsClients.get(sessionId)
		if (!clients) {
			clients = new Set()
			this.wsClients.set(sessionId, clients)
		}

		// Add this client
		clients.add(ws)

		// Handle client disconnect
		ws.on("close", () => {
			clients?.delete(ws)
			if (clients?.size === 0) {
				this.wsClients.delete(sessionId)
			}
		})
	}

	/**
	 * Notify all WebSocket clients for a session
	 */
	private notifySessionClients(sessionId: string, data: any) {
		const clients = this.wsClients.get(sessionId)
		if (clients) {
			const message = JSON.stringify(data)
			clients.forEach((client) => {
				if (client.readyState === WebSocket.OPEN) {
					client.send(message)
				}
			})
		}
	}

	/**
	 * Add a WebSocket client to a session
	 */
	public addWebSocketClient(sessionId: string, ws: WebSocket): void {
		let clients = this.wsClients.get(sessionId)
		if (!clients) {
			clients = new Set()
			this.wsClients.set(sessionId, clients)
		}
		clients.add(ws)
	}

	/**
	 * Remove a WebSocket client from a session
	 */
	public removeWebSocketClient(sessionId: string, ws: WebSocket): void {
		const clients = this.wsClients.get(sessionId)
		if (clients) {
			clients.delete(ws)
			if (clients.size === 0) {
				this.wsClients.delete(sessionId)
			}
		}
	}

	// 新增: 處理 AI 回應的方法
	public handleAssistantResponse(sessionId: string, content: string, isComplete: boolean = false) {
		const session = this.chatSessions.get(sessionId)
		if (!session) {
			Logger.log(`[${new Date().toISOString()}] HTTP API Error: Chat session ${sessionId} not found`)
			return
		}

		let message: ChatMessage
		const lastMessage = session.messages[session.messages.length - 1]

		// 如果最後一條消息是 assistant 且未完成，則更新它
		if (lastMessage && lastMessage.type === "assistant" && !lastMessage.complete) {
			message = lastMessage
			message.content = content
			message.complete = isComplete
		} else {
			// 否則創建新消息
			message = {
				type: "assistant",
				content: content,
				timestamp: new Date().toISOString(),
				complete: isComplete,
			}
			session.messages.push(message)
		}

		// 通知 WebSocket 客戶端
		const messageResponse: ChatMessageResponse = {
			sessionId,
			message,
		}
		this.notifySessionClients(sessionId, {
			type: "message",
			data: messageResponse,
		})

		// 如果消息完成，發送完成狀態
		if (isComplete) {
			session.status = "completed"
			session.updatedAt = new Date().toISOString()

			// 通知客戶端會話狀態更新
			this.notifySessionClients(sessionId, {
				type: "status",
				data: {
					status: "completed",
					timestamp: session.updatedAt,
				},
			})
		}
	}
}
