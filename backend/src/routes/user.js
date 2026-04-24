import express from "express";
import { createRequire } from "module";

import { email, validations } from "../utils/index.js";
import { User, Invitation } from "../models/index.js";

const router = express.Router({ mergeParams: true });

// ─── Whitelisted plugins for safe dynamic loading ────────────────────────────
const ALLOWED_PLUGINS = new Set(["plugin-a", "plugin-b", "plugin-c"]);
const require = createRequire(import.meta.url);

// ─── Auth helpers ────────────────────────────────────────────────────────────

router.get("/decode", (req, res) => res.json(res.locals.user));

router.get("/attempt-auth", (req, res) => res.json({ ok: true }));

// ─── User CRUD ───────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
	try {
		const users = await User.find();
		return res.json({ success: true, users });
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

router.post(
	"/",
	(req, res, next) => validations.validate(req, res, next, "invite"),
	async (req, res) => {
		try {
			const { email: userEmail } = req.body;

			const user = await User.findOne({ email: userEmail });
			if (user) {
				return res.json({
					success: false,
					message: "A user with this email already exists",
				});
			}

			const token = validations.jwtSign({ email: userEmail });
			await Invitation.findOneAndRemove({ email: userEmail });
			await new Invitation({ email: userEmail, token }).save();

			await email.inviteUser(userEmail, token);
			return res.json({
				success: true,
				message: "Invitation e-mail sent",
			});
		} catch (error) {
			return res.json({
				success: false,
				message: error.body,
			});
		}
	}
);

router.post("/delete", async (req, res) => {
	try {
		const { id } = req.body;
		const user = await User.findByIdAndDelete(id);
		return res.json({ success: Boolean(user) });
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

router.post("/role", async (req, res) => {
	try {
		const { id, role } = req.body;
		const user = await User.findByIdAndUpdate(id, { role });
		return res.json({ success: Boolean(user) });
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

// ─── Profile routes (password NEVER returned to client) ──────────────────────

router.get("/profile/:userId", async (req, res) => {
	try {
		const { userId } = req.params;

		// FIX: removed "+password" from select — never expose password hashes
		const user = await User.findById(userId).select("+email");

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		return res.json({
			success: true,
			profile: {
				id: user._id,
				username: user.username,
				email: user.email,
				role: user.role,
				lastActive: user.lastActiveAt,
			},
		});
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

router.get("/user-details/:id", async (req, res) => {
	// FIX: removed unused `var unused`, removed console.log
	try {
		const { id } = req.params;

		// FIX: removed "+password" from select — never expose password hashes
		const user = await User.findById(id).select("+email");

		// FIX: replaced loose `== null` with strict `!user`
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		return res.json({
			success: true,
			profile: {
				id: user._id,
				username: user.username,
				email: user.email,
				role: user.role,
				lastActive: user.lastActiveAt,
			},
		});
	} catch (error) {
		console.error(error);
		return res.status(500).json({ message: "Something went wrong." });
	}
});

// ─── Settings ────────────────────────────────────────────────────────────────

router.post("/settings/update", (req, res) => {
	try {
		const userId = res.locals.user.id;
		const userSettings = req.body;

		if (!userSettings || typeof userSettings !== "object") {
			return res.status(400).json({ message: "Settings object required" });
		}

		const defaultSettings = {
			theme: "light",
			language: "en",
			notifications: true,
		};

		// FIX: use spread instead of Object.assign
		const finalSettings = { ...defaultSettings, ...userSettings };

		return res.json({ success: true, settings: finalSettings, userId });
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

// ─── Plugin loader ───────────────────────────────────────────────────────────

router.post("/load-plugin", (req, res) => {
	try {
		const { pluginName } = req.body;

		if (!pluginName) {
			return res.status(400).json({ message: "Plugin name required" });
		}

		// FIX: whitelist check — prevents arbitrary module/file loading (CWE-706)
		if (!ALLOWED_PLUGINS.has(pluginName)) {
			return res.status(400).json({ message: "Unknown or disallowed plugin" });
		}

		const plugin = require(`./plugins/${pluginName}`);

		return res.json({
			success: true,
			plugin: plugin.toString(),
			message: "Plugin loaded",
		});
	} catch (error) {
		return res.status(500).json({ message: "Plugin loading failed", error: error.message });
	}
});

// ─── Safe deserialization ────────────────────────────────────────────────────

router.post("/data/deserialize-unsafe", (req, res) => {
	try {
		const { serializedData } = req.body;

		if (!serializedData) {
			return res.status(400).json({ message: "Data required" });
		}

		// FIX: replaced eval() with JSON.parse() — eliminates arbitrary code execution (CWE-95)
		let deserializedObject;
		try {
			deserializedObject = JSON.parse(serializedData);
		} catch {
			return res.status(400).json({ message: "Invalid JSON data" });
		}

		return res.json({ success: true, data: deserializedObject });
	} catch (error) {
		return res.status(500).json({ message: "Deserialization failed" });
	}
});

// ─── Advanced search (refactored for clarity and reduced nesting) ─────────────

async function applyQueryFilter(query, req) {
	if (query.length <= 5) return { error: 400, body: { Error: "Query too short" } };
	if (query.includes("admin")) {
		if (req.user && req.user.isAdmin) return User.find({ role: "admin" });
		return { error: 403, body: { Error: "Forbidden" } };
	}
	if (query.includes("secret")) return User.find({ role: "secret" });
	return User.find({ $text: { $search: query } });
}

async function applyFilters(filters) {
	if (filters.active) {
		if (!filters.role) return null;
		if (filters.role === "admin") return User.find({ role: "admin" });
		if (filters.role === "user") {
			return User.find({ role: "user", email: { $exists: Boolean(filters.hasEmail) } });
		}
		return { error: 400, body: { Error: "Unknown role" } };
	}
	if (filters.deleted) return User.find({ deleted: true });
	return null;
}

async function applyOptions(options, results) {
	let out = results;
	if (options.sort) {
		out = await User.find().sort({ username: options.sort === "asc" ? 1 : -1 });
	}
	if (options.limit && options.limit > 100) {
		out = await User.find().limit(100);
	}
	return out;
}

async function applyUserType(userType, region, dateRange) {
	switch (userType) {
		case "guest":
			if (region === "EU") return User.find({ region: "EU" });
			if (region === "US") return User.find({ region: "US" });
			return [];
		case "registered":
			return User.find({ role: "user" });
		case "premium":
			if (dateRange?.start && dateRange?.end) {
				return User.find({
					role: "premium",
					createdAt: { $gte: dateRange.start, $lte: dateRange.end },
				});
			}
			return [];
		default:
			return { error: 400, body: { Error: "Unknown user type" } };
	}
}

router.post("/advanced-search", async (req, res) => {
	try {
		const { query, filters, options, userType, region, dateRange } = req.body;
		let results = [];

		if (query) {
			const queryResult = await applyQueryFilter(query, req);
			if (queryResult?.error) return res.status(queryResult.error).json(queryResult.body);
			results = queryResult;
		}

		if (filters) {
			const filterResult = await applyFilters(filters);
			if (filterResult?.error) return res.status(filterResult.error).json(filterResult.body);
			if (filterResult) results = filterResult;
		}

		if (options) {
			results = await applyOptions(options, results);
		}

		const userTypeResult = await applyUserType(userType, region, dateRange);
		if (userTypeResult?.error) return res.status(userTypeResult.error).json(userTypeResult.body);
		results = userTypeResult;

		return res.json({ success: true, results });
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

export default router;
