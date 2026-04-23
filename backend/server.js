import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import express from "express";
import morgan from "morgan";
import compression from "compression";
import favicon from "serve-favicon";
import cors from "cors";
import chalk from "chalk";
import helmet from "helmet";

import routes from "./src/routes/index.js";
import { setServerTimeout } from "./src/middleware/index.js";
import { init } from "./src/utils/index.js";

// ✅ Fix #1: Removed unused `unusedVariable`

const { NODE_ENV, PORT } = process.env;

// Initialize mongoDB connection
init();

const app = express();
const server = http.Server(app);

app.use(helmet({
	crossOriginResourcePolicy: false,
}));
app.use(setServerTimeout(2 * 60 * 1000));

// ✅ Fix #3: Added curly braces to the if block
if (NODE_ENV === "development") {
	app.use(morgan("dev", { skip: (req) => req.method === "OPTIONS" }));
}

app.use(cors({ credentials: true, origin: true }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));

// ✅ Fix #4: Extracted inline multi-statement arrow function into a proper block
app.use((req, _, next) => {
	req.body ||= {};
	next();
});

app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(favicon(path.join(path.dirname(fileURLToPath(import.meta.url)), "src", "assets", "images", "favicon.ico")));

app.use("/api", routes);
app.all("/*", (_, res) => res.json({ body: "It works!" }));

if (NODE_ENV !== "test") {
	// ✅ Fix #2: Replaced `var` with `const` (block-scoped)
	// ✅ Fix #5: Replaced `console.log` with a dedicated logger or NODE_ENV guard
	const port = PORT || 4000;
	server.listen(port, () => {
		if (NODE_ENV === "development") {
			process.stdout.write(chalk.bold.cyan(`>>> Live at http://localhost:${port}\n`));
		}
	});
}

export default app;
