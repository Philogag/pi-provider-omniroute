## 1. 测试先行（认证行为用例）

- [x] 1.1 `test/lazy-fetch.test.ts`：mock fetch 捕获请求 init，新增用例——context 携带 `credential: {type:"api_key", key}` 时，`refreshModels` 发出的 GET 请求带 `Authorization: Bearer <key>` 头且 URL 为 `${baseUrl}/models`；响应 2xx 后 `getModels()` 填充新列表。
- [x] 1.2 `test/lazy-fetch.test.ts`：新增用例——context 无 `credential` 但设置 `OMNIROUTE_API_KEY` 时，请求同样携带 `Authorization: Bearer <env>`；用例内设置/清理该环境变量。
- [x] 1.3 `test/lazy-fetch.test.ts`：新增用例——settings.json block 中 baseUrl 以 `/` 结尾（如 `https://route.ai.philogag.com/v1/`）时，请求 URL 为 `…/v1/models`（断言不含 `//models`）。
- [x] 1.4 `test/models-metadata.test.ts` / `lazy-fetch.test.ts`：既有裸 `{signal}` 形态用例保持通过（无 credential、无 env 时仍发请求，401/网络错误冒泡语义不变）。

## 2. 实现 refreshModels 认证

- [x] 2.1 `src/index.ts`：`refreshModels` 网络阶段解析 api key——优先 `c.credential?.type === "api_key"` 的 `key`，回退 `process.env.OMNIROUTE_API_KEY`；取到 key 时 fetch 附加 `headers: { Authorization: \`Bearer ${key}\` }`。
- [x] 2.2 `src/index.ts`：请求 URL 改用去尾斜杠拼接 `\`${baseUrl.replace(/\/+$/, "")}/models\``（与 `omnirouteRequest` 惯例一致）；`allowNetwork:false` 早退、restore/publish/store 双契约与错误冒泡分支保持原样。

## 3. 回归与文档

- [x] 3.1 运行 `npm test` 与 `npm run typecheck`，全部通过（含新增用例）。
- [x] 3.2 `README.md` / `README.zh-CN.md`：模型自动导入/刷新小节补充一句"刷新 `/models` 时携带解析到的 API key（Bearer）"。
- [x] 3.3 运行 `openspec-cn validate`（对 change `fix-omniroute-model-refresh-auth`）通过。
