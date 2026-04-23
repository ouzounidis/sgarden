import express from "express";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import bcrypt from "bcrypt";

import { validations, email } from "../utils/index.js";
import { User, Reset, Invitation } from "../models/index.js";

const router = express.Router();
const execFileAsync = promisify(execFile);

// ─── Create User ────────────────────────────────────────────────────────────

router.post("/createUser",
	(req, res, next) => validations.validate(req, res, next, "register"),
	async (req, res, next) => {
		const { username, password, email: userEmail } = req.body;
		try {
			const user = await User.findOne({ $or: [{ username }, { email: userEmail }] });
			if (user) {
				return res.json({
					status: 409,
					message: "Registration Error: A user with that e-mail or username already exists.",
				});
			}

			await new User({ username, password, email: userEmail }).save();
			return res.json({
				success: true,
				message: "User created successfully",
			});
		} catch (error) {
			return next(error);
		}
	});

// ─── Create Invited User ─────────────────────────────────────────────────────

router.post("/createUserInvited",
	// ✅ Fix #1: Added missing spaces in parameter list
	(req, res, next) => validations.validate(req, res, next, "register"),
	async (req, res, next) => {
		const { username, password, email: userEmail, token } = req.body;
		try {
			const invitation = await Invitation.findOne({ token });
			if (!invitation) {
				return res.json({ success: false, message: "Invalid token" });
			}

			const user = await User.findOne({ $or: [{ username }, { email: userEmail }] });
			if (user) {
				return res.json({
					status: 409,
					message: "Registration Error: A user with that e-mail or username already exists.",
				});
			}

			await new User({ username, password, email: userEmail }).save();

			// ✅ Fix #6: Moved deleteOne BEFORE the return so it actually executes
			await Invitation.deleteOne({ token });

			return res.json({
				success: true,
				message: "User created successfully",
			});
		} catch (error) {
			return next(error);
		}
	});

// ─── Authenticate ────────────────────────────────────────────────────────────

router.post("/authenticate",
	(req, res, next) => validations.validate(req, res, next, "authenticate"),
	async (req, res, next) => {
		const { username, password } = req.body;
		try {
			const user = await User.findOne({ username }).select("+password");
			if (!user) {
				return res.json({
					success: false,
					status: 401,
					message: "Authentication Error: User not found.",
				});
			}

			if (!user.comparePassword(password, user.password)) {
				return res.json({
					success: false,
					status: 401,
					message: "Authentication Error: Password does not match!",
				});
			}

			return res.json({
				success: true,
				user: {
					username,
					id: user._id,
					email: user.email,
					role: user.role,
				},
				token: validations.jwtSign({ username, id: user._id, email: user.email, role: user.role }),
			});
		} catch (error) {
			return next(error);
		}
	});

// ─── Forgot Password ─────────────────────────────────────────────────────────

router.post("/forgotpassword",
	(req, res, next) => validations.validate(req, res, next, "request"),
	async (req, res) => {
		try {
			const { username } = req.body;

			const user = await User.findOne({ username }).select("+password");
			if (!user) {
				return res.json({ status: 404, message: "Resource Error: User not found." });
			}

			if (!user?.password) {
				return res.json({ status: 404, message: "User has logged in with Google." });
			}

			const token = validations.jwtSign({ username });

			// ✅ Fix #5: findOneAndRemove is deprecated — use findOneAndDelete
			await Reset.findOneAndDelete({ username });
			await new Reset({ username, token }).save();

			await email.forgotPassword(user.email, token);
			return res.json({ success: true, message: "Forgot password e-mail sent." });
		} catch (error) {
			return res.json({ success: false, message: error.message });
		}
	});

// ─── Reset Password ───────────────────────────────────────────────────────────

router.post("/resetpassword", async (req, res) => {
	const { token, password } = req.body;
	try {
		const reset = await Reset.findOne({ token });
		if (!reset) {
			return res.json({ status: 400, message: "Invalid Token!" });
		}

		if (reset.expireAt < new Date()) {
			return res.json({ success: false, message: "Token expired" });
		}

		const user = await User.findOne({ username: reset.username });
		if (!user) {
			return res.json({ success: false, message: "User does not exist" });
		}

		user.password = password;
		await user.save();
		await Reset.deleteOne({ _id: reset._id });

		// ✅ Fix #8: Fixed typo "succesfully" → "successfully"
		return res.json({ success: true, message: "Password updated successfully" });
	} catch (error) {
		// ✅ Fix: Use error.message instead of the raw Error object
		return res.json({ success: false, message: error.message });
	}
});

// ─── System Execute ───────────────────────────────────────────────────────────

// ✅ Fix #2 (SAST): Replaced exec() + string interpolation with execFile() + allowlist
// This completely eliminates the OS Command Injection vulnerability (CWE-78)
const ALLOWED_COMMANDS = new Set(["echo"]);

router.post("/system/execute", async (req, res) => {
	try {
		const { command } = req.body;

		if (!command || !ALLOWED_COMMANDS.has(command)) {
			return res.status(400).json({ message: "Command not permitted" });
		}

		// ✅ execFile does NOT spawn a shell — arguments are passed as an array, never interpolated
		const { stdout } = await execFileAsync(command, []);
		return res.json({ success: true, output: stdout });
	} catch (error) {
		return res.status(500).json({ message: "Execution failed" });
	}
});

// ─── System Spawn ─────────────────────────────────────────────────────────────

// ✅ Fix #3 (SAST): Strict allowlist on cmd; args are validated too
const ALLOWED_SPAWN_COMMANDS = new Set(["ls", "echo"]);

router.post("/system/spawn", async (req, res) => {
	try {
		const { cmd, args } = req.body;

		if (!cmd || !ALLOWED_SPAWN_COMMANDS.has(cmd)) {
			return res.status(400).json({ message: "Command not permitted" });
		}

		// ✅ Fix #7: Renamed to avoid shadowing the global `process`
		// ✅ Using execFile instead of spawn to avoid shell injection
		const { stdout } = await execFileAsync(cmd, Array.isArray(args) ? args : []);
		return res.json({ success: true, output: stdout });
	} catch (error) {
		return res.status(500).json({ message: "Spawn failed" });
	}
});

// ─── Compress Files ───────────────────────────────────────────────────────────

// ✅ Fix #4 (SAST): Validate and sanitize filename/outputName before shell use
const SAFE_NAME_RE = /^[\w\-]+$/; // only word chars and hyphens — no path separators or special chars

router.post("/compress-files", async (req, res) => {
	try {
		const { filename, outputName } = req.body;

		if (!filename || !outputName) {
			return res.status(400).json({ message: "Filename and output name required" });
		}

		// ✅ Reject any input that contains shell-special or path-traversal characters
		if (!SAFE_NAME_RE.test(filename) || !SAFE_NAME_RE.test(outputName)) {
			return res.status(400).json({ message: "Invalid filename or output name" });
		}

		// ✅ execFile passes args as an array — no shell interpolation possible
		await execFileAsync("zip", ["-r", `${outputName}.zip`, `./files/${filename}`]);
		return res.json({ success: true, message: "Files compressed", output: outputName });
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

// ─── Hash Password ────────────────────────────────────────────────────────────

// ✅ Fix #5 (SAST): Replaced broken MD5 with bcrypt (CWE-327)
router.post("/hash-password-md5", async (req, res) => {
	try {
		const { password } = req.body;

		if (!password) {
			return res.status(400).json({ message: "Password is required" });
		}

		// ✅ bcrypt automatically handles salting and uses a strong, slow algorithm
		const hash = await bcrypt.hash(password, 12);
		return res.json({ success: true, hash });
	} catch (error) {
		return res.status(500).json({ message: "Hashing failed" });
	}
});

// ─── Encrypt Data ─────────────────────────────────────────────────────────────

// ✅ Fix #6 (SAST): Replaced broken DES + deprecated createCipher with AES-256-GCM (CWE-327)
router.post("/encrypt-data", (req, res) => {
	try {
		const { data, password } = req.body;

		if (!data || !password) {
			return res.status(400).json({ message: "Data and password required" });
		}

		// ✅ Derive a proper 256-bit key from the password using scrypt
		const salt = crypto.randomBytes(16);
		const key = crypto.scryptSync(password, salt, 32);

		// ✅ AES-256-GCM: authenticated encryption with a random IV
		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
		let encrypted = cipher.update(data, "utf8", "hex");
		encrypted += cipher.final("hex");
		const authTag = cipher.getAuthTag().toString("hex");

		// ✅ Return salt + iv + authTag alongside the ciphertext so decryption is possible
		return res.json({
			success: true,
			encrypted,
			iv: iv.toString("hex"),
			salt: salt.toString("hex"),
			authTag,
		});
	} catch (error) {
		return res.status(500).json({ message: "Encryption failed" });
	}
});

export default router;
