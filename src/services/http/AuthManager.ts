import * as jwt from "jsonwebtoken"
import { JwtPayload, AuthTokenResponse } from "../../shared/HttpServerTypes"
import crypto from "crypto"

/**
 * Manages JWT token generation and validation for the HTTP server
 */
export class AuthManager {
	private secret: string
	private tokenExpiryTime: number // in seconds

	constructor(tokenExpiryTimeInHours: number = 24) {
		// Generate a random secret on initialization
		// In a production environment, this should be stored securely and persisted
		this.secret = crypto.randomBytes(64).toString("hex")
		this.tokenExpiryTime = tokenExpiryTimeInHours * 60 * 60 // convert hours to seconds
	}

	/**
	 * Generates a new JWT token
	 * @returns The generated token and its expiration timestamp
	 */
	generateToken(): AuthTokenResponse {
		const timestamp = Math.floor(Date.now() / 1000)
		const expiresAt = timestamp + this.tokenExpiryTime

		const payload: JwtPayload = {
			userId: crypto.randomUUID(),
			timestamp,
			exp: expiresAt,
		}

		const token = jwt.sign(payload, this.secret)

		return {
			token,
			expiresAt,
		}
	}

	/**
	 * Validates a JWT token
	 * @param token The token to validate
	 * @returns True if the token is valid, false otherwise
	 */
	validateToken(token: string): boolean {
		try {
			jwt.verify(token, this.secret)
			return true
		} catch (error) {
			return false
		}
	}

	/**
	 * Middleware function for Express to validate JWT tokens
	 * @param req Express request
	 * @param res Express response
	 * @param next Express next function
	 */
	authMiddleware = (req: any, res: any, next: any) => {
		// Get the token from the Authorization header
		const authHeader = req.headers.authorization
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ error: "Unauthorized: No token provided" })
		}

		const token = authHeader.split(" ")[1]

		// Validate the token
		if (!this.validateToken(token)) {
			return res.status(401).json({ error: "Unauthorized: Invalid token" })
		}

		next()
	}
}
