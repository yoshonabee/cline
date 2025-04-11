import express from "express"
import * as http from "http"
import cors from "cors"
import helmet from "helmet"
import { WebSocket } from "ws"
import type { Server as WebSocketServer } from "ws"
import { Controller } from "../../core/controller"
import { AuthManager } from "./AuthManager"
import { HttpController } from "./HttpController"
import { Logger } from "../../services/logging/Logger"
import * as vscode from "vscode"

/**
 * Manages the HTTP server for external access to Cline
 */
export class HttpServerService {
	private server: http.Server | null = null
	private wss: WebSocketServer | null = null
	private app: express.Application
	private authManager: AuthManager
	private httpController: HttpController
	private port: number = 3000 // Default port

	constructor(private controllerRef: WeakRef<Controller>) {
		this.app = express()
		this.authManager = new AuthManager()

		// Initialize the controller with references to the controller and auth manager
		this.httpController = new HttpController(controllerRef, this.authManager)

		// 將 HttpController 實例傳遞給 Controller
		const controller = controllerRef.deref()
		if (controller) {
			controller.setHttpController(this.httpController)
		}

		// Configure middleware
		this.configureMiddleware()

		// Set up routes
		this.app.use(this.httpController.getRouter())
	}

	/**
	 * Configure Express middleware
	 */
	private configureMiddleware(): void {
		// Security middleware
		this.app.use(helmet())

		// CORS middleware
		this.app.use(cors())

		// JSON body parser
		this.app.use(express.json())

		// Add basic request logging
		this.app.use((req, res, next) => {
			Logger.log(`HTTP API: ${req.method} ${req.path}`)
			next()
		})
	}

	/**
	 * Start the HTTP server if enabled in settings
	 */
	async start(): Promise<void> {
		// Check if HTTP server is enabled in settings
		const config = vscode.workspace.getConfiguration("cline.http")
		const enabled = config.get<boolean>("enabled", false)

		if (!enabled) {
			Logger.log("HTTP server is disabled in settings")
			return
		}

		// Get port from settings
		this.port = config.get<number>("port", 3000)

		// Create and start the server
		this.server = http.createServer(this.app)

		if (!this.server) {
			throw new Error("Failed to create HTTP server")
		}

		// Initialize WebSocket server
		const WebSocketServerImpl = require("ws").Server
		this.wss = new WebSocketServerImpl({ server: this.server })

		if (!this.wss) {
			throw new Error("Failed to create WebSocket server")
		}

		// Handle WebSocket connections
		this.wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
			try {
				Logger.log(`[${new Date().toISOString()}] WebSocket: 收到新的連接請求`)

				// Extract session ID from URL query parameters
				const url = new URL(req.url || "", `http://${req.headers.host}`)
				const sessionId = url.searchParams.get("sessionId")

				if (!sessionId) {
					Logger.log(`[${new Date().toISOString()}] WebSocket Error: 缺少 sessionId 參數`)
					ws.close(1002, "Session ID is required")
					return
				}

				// Extract and validate token from headers
				const authHeader = req.headers["authorization"]
				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					Logger.log(`[${new Date().toISOString()}] WebSocket Error: 缺少或無效的認證 token`)
					ws.close(1002, "Authorization header with Bearer token is required")
					return
				}

				const token = authHeader.substring(7)
				if (!this.authManager.validateToken(token)) {
					Logger.log(`[${new Date().toISOString()}] WebSocket Error: token 驗證失敗`)
					ws.close(1002, "Invalid or expired token")
					return
				}

				// Add client to session
				this.httpController.addWebSocketClient(sessionId, ws)
				Logger.log(`[${new Date().toISOString()}] WebSocket: 客戶端已連接到會話 ${sessionId}`)

				// Handle client disconnect
				ws.on("close", () => {
					this.httpController.removeWebSocketClient(sessionId, ws)
					Logger.log(`[${new Date().toISOString()}] WebSocket: 客戶端已從會話 ${sessionId} 斷開連接`)
				})

				// Handle errors
				ws.on("error", (error) => {
					Logger.log(`[${new Date().toISOString()}] WebSocket Error: 會話 ${sessionId} 發生錯誤: ${error}`)
					ws.close(1011, "Internal server error")
				})
			} catch (error) {
				Logger.log(`[${new Date().toISOString()}] WebSocket Error: ${error}`)
				ws.close(1011, "Internal server error")
			}
		})

		return new Promise((resolve, reject) => {
			if (!this.server) {
				reject(new Error("Server was not properly initialized"))
				return
			}

			this.server.listen(this.port, () => {
				Logger.log(`HTTP server listening on port ${this.port}`)
				resolve()
			})

			this.server.on("error", (error) => {
				Logger.log(`HTTP server error: ${error.message}`)
				reject(error)
			})
		})
	}

	/**
	 * Stop the HTTP server
	 */
	async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.wss) {
				this.wss.close(() => {
					Logger.log("WebSocket server stopped")
				})
				this.wss = null
			}

			if (!this.server) {
				resolve()
				return
			}

			this.server.close(() => {
				Logger.log("HTTP server stopped")
				this.server = null
				resolve()
			})
		})
	}

	/**
	 * Restart the server (stop and start again)
	 * Useful when settings are changed
	 */
	async restart(): Promise<void> {
		await this.stop()
		await this.start()
	}

	/**
	 * Generate a new JWT token
	 * This can be called from within VSCode commands
	 */
	generateToken(): string {
		const tokenResponse = this.authManager.generateToken()
		return tokenResponse.token
	}
}
