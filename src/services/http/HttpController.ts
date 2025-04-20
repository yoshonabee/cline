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
	ChatSession,
} from "../../shared/HttpServerTypes"
import { Logger } from "../../services/logging/Logger"
import { WebSocket } from "ws"
import { ExtensionMessage } from "../../shared/ExtensionMessage"

/**
 * Handles HTTP API requests and routes them to the appropriate controller methods.
 */
export class HttpController {
	private router: Router
	private chatSessions: Map<string, ChatSession> = new Map()
	private wsClients: Map<string, Set<WebSocket>> = new Map()
	private lastMessage: ExtensionMessage | null = null

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
				status: "active",
				createdAt: now,
				updatedAt: now,
			}

			// Store the session
			this.chatSessions.set(sessionId, session)

			Logger.log(`[${new Date().toISOString()}] HTTP API: 創建新的聊天會話 ${sessionId}`)

			// 設置當前會話 ID 到 controller
			controller.setCurrentSessionId(sessionId)
			Logger.log(`[${new Date().toISOString()}] HTTP API: 已設置當前會話 ID 到 controller: ${sessionId}`)

			// Initialize task with the message
			await visibleWebview.controller.initTask(chatRequest.text, chatRequest.images)
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

			// Notify WebSocket clients
			const clients = this.wsClients.get(sessionId)
			if (clients) {
				clients.forEach((client) => {
					if (client.readyState === WebSocket.OPEN) {
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
	public handleAssistantResponse(sessionId: string, message: ExtensionMessage) {
		const session = this.chatSessions.get(sessionId)
		if (!session) {
			Logger.log(`[${new Date().toISOString()}] HTTP API Error: Chat session ${sessionId} not found`)
			return
		}

		Logger.log(`[${new Date().toISOString()}] HTTP API: 收到 Controller 回應: ${message.type}`)

		Logger.log(`[${new Date().toISOString()}] HTTP API: 收到 Controller 回應 say: ${message.partialMessage?.say}`)

		if (message.type === "partialMessage") {
			let partialMessage
			if (
				this.lastMessage &&
				this.lastMessage.type === "partialMessage" &&
				this.lastMessage.partialMessage?.ts === message.partialMessage?.ts
			) {
				partialMessage = message.partialMessage?.text?.slice(this.lastMessage?.partialMessage?.text?.length || 0) || ""
			} else {
				partialMessage = message.partialMessage?.text || ""
			}

			this.lastMessage = JSON.parse(JSON.stringify(message))
			this.notifySessionClients(sessionId, { message: partialMessage })
		}

		// 通知 WebSocket 客戶端
	}
}
