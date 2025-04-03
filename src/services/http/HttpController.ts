import { Request, Response, Router } from "express"
import { AuthManager } from "./AuthManager"
import { Controller } from "../../core/controller"
import { WebviewProvider } from "../../core/webview"
import {
	TaskCreationRequest,
	TaskCreationResponse,
	ToolExecutionRequest,
	ToolExecutionResponse,
	TaskStatusResponse,
} from "../../shared/HttpServerTypes"
import { Logger } from "../../services/logging/Logger"

/**
 * Handles HTTP API requests and routes them to the appropriate controller methods.
 */
export class HttpController {
	private router: Router

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

		// Authenticated endpoints
		this.router.post("/api/tasks/new", this.authMiddleware.bind(this), this.createTask.bind(this))
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
}

// Add this for type completion in VSCode
import * as vscode from "vscode"
