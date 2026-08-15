//#region src/index.ts
const name = "session-handover";
/** Services required before the handover surfaces can mount. */
const inject = [
	"webServer",
	"tools",
	"sessionQuery",
	"llm",
	"fs",
	"agentDefaultModel",
	"sandboxPolicy",
	"sessions"
];
const MAX_JSON_BODY_BYTES = 1048576;
function isLoopbackRequest(request) {
	const address = request.socket.remoteAddress;
	if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
	const host = request.headers.host;
	if (typeof host !== "string") return false;
	let hostUrl;
	try {
		hostUrl = new URL(`http://${host}`);
	} catch {
		return false;
	}
	if (hostUrl.hostname !== "127.0.0.1" && hostUrl.hostname !== "localhost" && hostUrl.hostname !== "[::1]") return false;
	if (request.headers["sec-fetch-site"] === "cross-site") return false;
	const origin = request.headers.origin;
	if (origin === void 0) return true;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
function writeJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"referrer-policy": "no-referrer"
	});
	res.end(payload);
}
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_JSON_BODY_BYTES) {
				reject(/* @__PURE__ */ new Error("请求体过大"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolve({});
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				reject(/* @__PURE__ */ new Error("请求体不是合法 JSON"));
			}
		});
		req.on("error", reject);
	});
}
function textOf(value, cap) {
	const limit = cap || 4e3;
	if (value === null || value === void 0) return "";
	if (typeof value === "string") return value.slice(0, limit);
	if (Array.isArray(value)) {
		let out = "";
		for (const item of value) {
			if (out.length >= limit) break;
			out += textOf(item, limit - out.length);
		}
		return out;
	}
	if (typeof value === "object") {
		if (typeof value.text === "string") return value.text.slice(0, limit);
		if (typeof value.content === "string") return value.content.slice(0, limit);
		if (Array.isArray(value.content)) return textOf(value.content, limit);
		if (typeof value.name === "string") return "[" + value.name + "] " + textOf(value.arguments || value.input || "", limit);
	}
	return "";
}
function eventText(event) {
	const t = event && event.type;
	const body = textOf(event && event.data || event && event.payload, 4e3);
	if (!body) return "";
	if (t === "user/message") return "用户: " + body;
	if (t === "assistant/message") return "助手: " + body;
	if (t === "tool/result") return "工具结果: " + body;
	return body;
}
async function transcriptOf(ctx, sessionId) {
	const sessionQuery = ctx.get("sessionQuery");
	const surface = await sessionQuery.readSurface(sessionId);
	let text = (surface && surface.events || []).map(eventText).filter(Boolean).join("\n");
	if (text.length > 6e4) text = text.slice(0, 4e4) + "\n……[中间省略]……\n" + text.slice(-2e4);
	let title = "";
	try {
		const t = await sessionQuery.readTitle(sessionId);
		title = t && t.title || "";
	} catch {}
	return {
		text,
		header: surface && surface.session || {},
		title
	};
}
async function runModel(ctx, prompt, maxTokens) {
	const llm = ctx.get("llm");
	const selection = ctx.get("agentDefaultModel").currentSelection();
	if (!selection || !selection.provider || !selection.model) throw new Error("未选择可用模型");
	let text = "";
	let reasoning = "";
	const seen = [];
	let finishKind = "none";
	const stream = llm.stream({
		provider: selection.provider,
		model: selection.model,
		messages: [{
			role: "user",
			content: [{
				type: "text",
				text: prompt
			}]
		}],
		temperature: .3,
		maxTokens,
		purpose: "session-title"
	});
	for await (const chunk of stream) {
		seen.push(chunk.type);
		if (chunk.type === "text-delta") text += chunk.text;
		else if (chunk.type === "reasoning-delta") reasoning += chunk.text;
		else if (chunk.type === "block-end") {
			const b = chunk.block || {};
			if (b.type === "text" && typeof b.text === "string") text += b.text;
			else if (b.type === "reasoning" && typeof b.text === "string") reasoning += b.text;
		} else if (chunk.type === "finish") {
			const reason = chunk.reason || {};
			finishKind = String(reason.kind || reason);
			if (finishKind === "error" || finishKind === "aborted") {
				const failure = reason.failure || {};
				throw new Error("模型调用失败: " + String(failure.message || failure.code || finishKind));
			}
			break;
		}
	}
	const out = text.trim() || reasoning.trim();
	if (!out) throw new Error("模型未返回内容（流块: " + (seen.join(",") || "空") + "，结束原因: " + finishKind + "）");
	return out;
}
function parseCandidates(raw) {
	const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = fence ? fence[1] : raw;
	try {
		const parsed = JSON.parse(body);
		const arr = Array.isArray(parsed) ? parsed : parsed && parsed.candidates;
		if (Array.isArray(arr)) {
			const list = arr.map((c) => ({
				label: String(c && (c.label || c.name) || "").slice(0, 20),
				description: String(c && (c.description || c.desc) || "")
			})).filter((c) => c.label);
			if (list.length) return list;
		}
	} catch {}
	const re = /\{\s*"label"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"description"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
	const out = [];
	let m;
	while ((m = re.exec(body)) !== null) out.push({
		label: m[1].slice(0, 20),
		description: m[2]
	});
	if (out.length) return out;
	return raw.split("\n").map((s) => s.replace(/^\s*[-*\d.、]+\s*/, "").trim()).filter(Boolean).slice(0, 5).map((l) => ({
		label: l.slice(0, 20),
		description: ""
	}));
}
function slugOf(text) {
	return String(text || "custom").trim().replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) || "custom";
}
/** The model occasionally emits the whole doc twice; cut at the second H1. */
function singleCopy(md) {
	const text = String(md || "").trim();
	if (!text) return "";
	const marker = "# 交接";
	const first = text.indexOf(marker);
	if (first < 0) return text;
	const second = text.indexOf(marker, first + 4);
	if (second < 0) return text;
	return text.slice(0, second).trim();
}
const ANALYZE_PROMPT_HEAD = [
	"你是会话交接助手。请阅读下面的会话内容，盘点议题/任务线索，并预测 3~5 个「新会话目标」候选。",
	"要求：",
	"- 最终输出严格 JSON 数组：[{\"label\": \"...\", \"description\": \"...\"}, ...]，不要其他文字；",
	"- label 不超过 10 个字；description 一句话说明该目标涵盖什么、不含什么；",
	"- 只放值得延续的方向（还有剩余工作），已闭环的议题不放；",
	"- 永远包含一个 {\"label\": \"综合继续\", \"description\": \"延续全部未完成议题\"}；",
	"- 会话只有单一主线时，候选可以是不同的侧重或下一步。",
	"",
	"## 会话内容"
].join("\n");
function finalizePromptHead(goal, custom) {
	return [
		"你是会话交接助手。请根据下面的会话内容写一份交接文档（Markdown），供一个新的空白会话快速恢复工作状态。",
		"",
		"新会话目标：" + goal,
		"补充说明：" + (custom || "无"),
		"",
		"文档结构（只写有内容的节，宁缺毋滥）：",
		"# 交接：<目标一句话>",
		"## 背景与现状（按延续的议题分小节：目标 / 已完成 / 当前状态 / 下一步）",
		"## 关键决策与约定",
		"## 相关文件与位置",
		"## 环境与常用命令",
		"## 注意事项",
		"## 建议的第一步",
		"",
		"要求：信息只来自会话内容，不确定的标【待确认】，绝不编造；精炼优先，全文 600 字以内；不要写「父会话」行（系统会自动加）。",
		"",
		"## 会话内容"
	].join("\n");
}
function apply(ctx, config) {
	const webServer = ctx.get("webServer");
	if (webServer !== void 0) {
		const disposeAnalyze = webServer.register({
			kind: "exact",
			path: "/api/dsh-handover/analyze",
			handler: async (req, res) => {
				try {
					if (!isLoopbackRequest(req)) {
						writeJson(res, 403, { error: "forbidden" });
						return;
					}
					const args = await readJsonBody(req);
					const sessionId = args && args.sessionId;
					if (!sessionId) {
						writeJson(res, 400, { error: "缺少会话 id" });
						return;
					}
					const t = await transcriptOf(ctx, sessionId);
					const raw = await runModel(ctx, ANALYZE_PROMPT_HEAD + "\n" + (t.text || "（会话内容为空）"), 2e3);
					writeJson(res, 200, {
						candidates: parseCandidates(raw),
						parentSessionId: sessionId,
						parentTitle: t.title,
						parentCwd: t.header && t.header.cwd || "",
						chars: t.text.length,
						debug: {
							rawLen: raw.length,
							rawHead: raw.slice(0, 300)
						}
					});
				} catch (error) {
					writeJson(res, 500, { error: String(error && error.message || error) });
				}
			}
		});
		const disposeFinalize = webServer.register({
			kind: "exact",
			path: "/api/dsh-handover/finalize",
			handler: async (req, res) => {
				try {
					if (!isLoopbackRequest(req)) {
						writeJson(res, 403, { error: "forbidden" });
						return;
					}
					const args = await readJsonBody(req);
					const sessionId = args && args.sessionId;
					const chosen = args && args.chosen || [];
					const custom = String(args && args.custom || "").trim();
					if (!sessionId) {
						writeJson(res, 400, { error: "缺少会话 id" });
						return;
					}
					if (!chosen.length && !custom) {
						writeJson(res, 400, { error: "未选择任何目标" });
						return;
					}
					const t = await transcriptOf(ctx, sessionId);
					const rawMd = await runModel(ctx, finalizePromptHead(chosen.length ? chosen.join("、") : custom, custom) + "\n" + (t.text || "（会话内容为空）"), 6e3);
					const md = singleCopy(rawMd);
					if (!md) {
						writeJson(res, 500, { error: "模型未生成交接文档内容" });
						return;
					}
					const deduped = md.length < String(rawMd || "").trim().length;
					const slug = slugOf(chosen[0] || custom);
					const cwd = t.header && t.header.cwd;
					if (!cwd) {
						writeJson(res, 500, { error: "无法确定会话工作目录" });
						return;
					}
					let stamp = "";
					try {
						stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
					} catch {}
					const headerLine = "> 父会话：" + sessionId + (t.title ? "（" + t.title + "）" : "") + (stamp ? "\n> 派生日期：" + stamp : "") + "\n\n";
					const fs = ctx.get("fs");
					let filename = "HANDOVER-" + slug + ".md";
					let target = await fs.resolve(filename, { cwd });
					let existed = false;
					try {
						existed = await fs.stat(target) !== void 0;
					} catch {}
					if (existed && stamp) {
						filename = "HANDOVER-" + slug + "-" + stamp + ".md";
						target = await fs.resolve(filename, { cwd });
					}
					const liveSessions = ctx.get("sessions");
					const sandboxPolicy = ctx.get("sandboxPolicy");
					const liveSession = liveSessions && liveSessions.get(sessionId);
					const policy = sandboxPolicy ? sandboxPolicy.resolve(liveSession ? { session: liveSession } : {}) : void 0;
					await fs.writeText(target, headerLine + md + "\n", void 0, void 0, policy);
					try {
						const written = await fs.readText(target);
						if ((written.match(/^#\s+/gm) || []).length > 1) await fs.writeText(target, headerLine + singleCopy(written.slice(headerLine.length)) + "\n", void 0, void 0, policy);
					} catch {}
					const prefill = "父会话：" + sessionId + (t.title ? "（" + t.title + "）" : "") + "\n按 " + filename + " 继续。\n需要回看父会话细节时，可在输入框输入 @ 引用父会话，或让助手用 parent_session_peek 工具查阅。";
					writeJson(res, 200, {
						docPath: filename,
						prefill,
						parentTitle: t.title,
						parentSessionId: sessionId,
						parentCwd: cwd,
						deduped,
						existed,
						chars: md.length
					});
				} catch (error) {
					writeJson(res, 500, { error: String(error && error.message || error) });
				}
			}
		});
		ctx.effect(() => () => {
			disposeAnalyze();
			disposeFinalize();
		}, "dsh-session-handover: routes");
	}
	const tools = ctx.get("tools");
	if (tools !== void 0) {
		const disposeTool = tools.register({
			name: "parent_session_peek",
			description: "查阅某个父会话的摘要或片段。派生新会话后，开场预填文本会写明父会话 id；没有 id 时不要调用。",
			parameters: {
				type: "object",
				properties: {
					sessionId: {
						type: "string",
						description: "父会话 id（见本会话第一条预填消息）"
					},
					query: {
						type: "string",
						description: "可选：想找的内容关键词"
					}
				},
				required: ["sessionId"]
			},
			output: {
				schema: {
					type: "object",
					properties: {
						title: { type: "string" },
						excerpt: { type: "string" },
						matches: { type: "number" },
						truncated: { type: "boolean" },
						error: { type: "string" }
					},
					additionalProperties: false
				},
				render(_args, value) {
					const v = value || {};
					return [{
						type: "text",
						text: v.error ? "错误：" + v.error : String(v.excerpt || "")
					}];
				}
			},
			async execute(args, _exec) {
				const sessionId = args && args.sessionId;
				if (!sessionId) return { error: "缺少会话 id" };
				const t = await transcriptOf(ctx, sessionId);
				const q = String(args && args.query || "").trim().toLowerCase();
				if (!q) return {
					title: t.title,
					excerpt: t.text.slice(0, 6e3),
					truncated: t.text.length > 6e3
				};
				const lines = t.text.split("\n");
				const hits = [];
				for (let i = 0; i < lines.length; i++) if (lines[i].toLowerCase().indexOf(q) !== -1) {
					hits.push(lines.slice(Math.max(0, i - 1), i + 2).join("\n"));
					if (hits.length >= 12) break;
				}
				const out = hits.join("\n----\n");
				return {
					title: t.title,
					matches: hits.length,
					excerpt: out ? out.slice(0, 6e3) : "未找到匹配内容"
				};
			}
		});
		ctx.effect(() => disposeTool, "dsh-session-handover: tool");
	}
}
//#endregion
export { apply, inject, name };
