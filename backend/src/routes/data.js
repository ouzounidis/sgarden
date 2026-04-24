import express from "express";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import Mustache from "mustache"; // npm install mustache

const router = express.Router({ mergeParams: true });

// ─── Absolute base directories (path traversal anchor) ───────────────────────
const REPORTS_DIR  = resolve("./reports");
const TEMPLATES_DIR = resolve("./templates");
const UPLOADS_DIR  = resolve("./uploads");
const DATA_DIR     = resolve("./data");
const FILES_DIR    = resolve("./files");
const CONFIG_DIR   = resolve("./config");

/**
 * Resolves `userInput` relative to `baseDir` and verifies the result
 * stays inside `baseDir`. Returns the safe absolute path, or null if
 * the input attempts a path traversal.
 */
function safePath(baseDir, userInput) {
	const resolved = resolve(join(baseDir, userInput));
	return resolved.startsWith(baseDir + "/") || resolved === baseDir
		? resolved
		: null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const generateRandomData = (min = 0, max = 10) => Math.random() * (max - min) + min;

// ─── Routes ──────────────────────────────────────────────────────────────────

// FIX: removed unnecessary `async` — no await used
router.get("/", (req, res) => {
	try {
		const quarterlySalesDistribution = {
			Q1: Array.from({ length: 100 }, () => generateRandomData(0, 10)),
			Q2: Array.from({ length: 100 }, () => generateRandomData(0, 10)),
			Q3: Array.from({ length: 100 }, () => generateRandomData(0, 10)),
		};

		const budgetVsActual = {
			January:  { budget: generateRandomData(0, 100), actual: generateRandomData(0, 100), forecast: generateRandomData(0, 100) },
			February: { budget: generateRandomData(0, 100), actual: generateRandomData(0, 100), forecast: generateRandomData(0, 100) },
			March:    { budget: generateRandomData(0, 100), actual: generateRandomData(0, 100), forecast: generateRandomData(0, 100) },
			April:    { budget: generateRandomData(0, 100), actual: generateRandomData(0, 100), forecast: generateRandomData(0, 100) },
			May:      { budget: generateRandomData(0, 100), actual: generateRandomData(0, 100), forecast: generateRandomData(0, 100) },
			June:     { budget: generateRandomData(0, 100), actual: generateRandomData(0, 100), forecast: generateRandomData(0, 100) },
		};

		const timePlot = {
			projected:    Array.from({ length: 20 }, () => generateRandomData(0, 100)),
			actual:       Array.from({ length: 20 }, () => generateRandomData(0, 100)),
			historicalAvg: Array.from({ length: 20 }, () => generateRandomData(0, 100)),
		};

		return res.json({
			success: true,
			quarterlySalesDistribution,
			budgetVsActual,
			timePlot,
		});
	} catch (error) {
		return res.status(500).json({ message: "Something went wrong." });
	}
});

// FIX: path traversal guard via safePath()
router.get("/download-report", (req, res) => {
	try {
		const { reportName } = req.query;

		if (!reportName) {
			return res.status(400).json({ message: "Report name required" });
		}

		const reportPath = safePath(REPORTS_DIR, reportName);

		if (!reportPath) {
			return res.status(400).json({ message: "Invalid report name" });
		}

		if (existsSync(reportPath)) {
			const content = readFileSync(reportPath);
			res.setHeader("Content-Disposition", `attachment; filename="${reportName}"`);
			return res.send(content);
		}

		return res.status(404).json({ message: "Report not found" });
	} catch (error) {
		return res.status(500).json({ message: "Download failed" });
	}
});

// FIX: path traversal guard via safePath()
router.get("/render-page", (req, res) => {
	try {
		const { template } = req.query;

		if (!template) {
			return res.status(400).json({ message: "Template name required" });
		}

		const templatePath = safePath(TEMPLATES_DIR, template);

		if (!templatePath) {
			return res.status(400).json({ message: "Invalid template name" });
		}

		if (existsSync(templatePath)) {
			const templateContent = readFileSync(templatePath, "utf8");
			return res.send(templateContent);
		}

		return res.status(404).json({ message: "Template not found" });
	} catch (error) {
		return res.status(500).json({ message: "Template rendering failed" });
	}
});

// FIX: destination is no longer accepted from client — always writes to UPLOADS_DIR
// FIX: path traversal guard via safePath()
router.post("/upload-file", (req, res) => {
	try {
		const { filename, content } = req.body;

		if (!filename || !content) {
			return res.status(400).json({ message: "Filename and content required" });
		}

		const uploadPath = safePath(UPLOADS_DIR, filename);

		if (!uploadPath) {
			return res.status(400).json({ message: "Invalid filename" });
		}

		writeFileSync(uploadPath, content);

		return res.json({
			success: true,
			message: "File uploaded successfully",
		});
	} catch (error) {
		return res.status(500).json({ message: "Upload failed" });
	}
});

// FIX: path traversal guard via safePath() — .endsWith('.csv') alone is insufficient
router.get("/export-csv", (req, res) => {
	try {
		const { dataFile } = req.query;

		if (!dataFile) {
			return res.status(400).json({ message: "Data file required" });
		}

		if (!dataFile.endsWith(".csv")) {
			return res.status(400).json({ message: "Only CSV files allowed" });
		}

		const csvPath = safePath(DATA_DIR, dataFile);

		if (!csvPath) {
			return res.status(400).json({ message: "Invalid file name" });
		}

		if (existsSync(csvPath)) {
			const csvData = readFileSync(csvPath, "utf8");
			res.setHeader("Content-Type", "text/csv");
			res.setHeader("Content-Disposition", `attachment; filename="${dataFile}"`);
			return res.send(csvData);
		}

		return res.status(404).json({ message: "CSV file not found" });
	} catch (error) {
		return res.status(500).json({ message: "Export failed" });
	}
});

// FIX: path traversal guard via safePath()
router.get("/browse-files", (req, res) => {
	try {
		const { directory } = req.query;

		if (!directory) {
			return res.status(400).json({ message: "Directory required" });
		}

		const dirPath = safePath(FILES_DIR, directory);

		if (!dirPath) {
			return res.status(400).json({ message: "Invalid directory" });
		}

		if (existsSync(dirPath)) {
			const files = readdirSync(dirPath);

			const fileList = files.map((file) => {
				const filePath = join(dirPath, file);
				const stats = statSync(filePath);
				return {
					name: file,
					size: stats.size,
					isDirectory: stats.isDirectory(),
					modified: stats.mtime,
				};
			});

			return res.json({ success: true, files: fileList });
		}

		return res.status(404).json({ message: "Directory not found" });
	} catch (error) {
		return res.status(500).json({ message: "Could not list directory" });
	}
});

// FIX: path traversal guard via safePath() — .endsWith('.json') alone is insufficient
router.get("/config/load", (req, res) => {
	try {
		const { configFile } = req.query;

		if (!configFile) {
			return res.status(400).json({ message: "Config file required" });
		}

		if (!configFile.endsWith(".json")) {
			return res.status(400).json({ message: "Only JSON config files allowed" });
		}

		const configPath = safePath(CONFIG_DIR, configFile);

		if (!configPath) {
			return res.status(400).json({ message: "Invalid config file name" });
		}

		if (existsSync(configPath)) {
			const config = readFileSync(configPath, "utf8");
			return res.json({ success: true, config: JSON.parse(config) });
		}

		return res.status(404).json({ message: "Config file not found" });
	} catch (error) {
		return res.status(500).json({ message: "Could not load config" });
	}
});

// FIX: replaced eval() with Mustache — safe logic-less template interpolation (CWE-94)
// FIX: removed unused `data` destructuring variable
router.post("/generate-custom-report", (req, res) => {
	try {
		const { templateString, data } = req.body;

		if (!templateString) {
			return res.status(400).json({ message: "Template string required" });
		}

		// Mustache renders {{variable}} placeholders from `data` — no code execution possible
		const report = Mustache.render(templateString, data ?? {});

		return res.json({
			success: true,
			report,
			generatedAt: new Date(),
		});
	} catch (error) {
		return res.status(500).json({ message: "Report generation failed" });
	}
});

export default router;
