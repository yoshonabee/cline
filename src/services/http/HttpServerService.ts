import express from "express"
import * as http from "http"
import cors from "cors"
import helmet from "helmet"
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
	private app: express.Application
	private authManager: AuthManager
	private httpController: HttpController
	private port: number = 3000 // Default port

	constructor(private controllerRef: WeakRef<Controller>) {
		this.app = express()
		this.authManager = new AuthManager()

		// Initialize the controller with references to the controller and auth manager
		this.httpController = new HttpController(controllerRef, this.authManager)

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
