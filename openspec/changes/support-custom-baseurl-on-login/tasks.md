## 1. Test infrastructure

- [x] 1.1 Add `test` and `typecheck` scripts to `package.json`
- [x] 1.2 Create `tsconfig.json` (NodeNext, strict, `@types/node`) and `test/` directory
- [x] 1.3 Run `npm test` and `npm run typecheck` to confirm both succeed (no source/tests yet)

## 2. `validateAndNormalizeBaseUrl` (TDD)

- [x] 2.1 Write `test/url.test.ts` covering 9 input cases (empty, whitespace, valid http/https, trailing slash, surrounding whitespace, missing protocol, non-http(s), missing hostname) plus the default constant assertion
- [x] 2.2 Run `npm test` to confirm failure
- [x] 2.3 Implement `validateAndNormalizeBaseUrl` and `OMNIROUTE_DEFAULT_BASE_URL` in `src/auth.ts`
- [x] 2.4 Run `npm test` to confirm all 10 pass
- [x] 2.5 Run `npm run typecheck` to confirm clean
- [x] 2.6 Commit

## 3. `readCredential` (TDD)

- [x] 3.1 Write `test/auth-credentials.test.ts` covering ENOENT, malformed JSON, missing `omniroute` key, valid credential, `resolveStoredBaseUrl` with/without env, `resolveAuthJsonPath` env override
- [x] 3.2 Run `npm test` to confirm failure
- [x] 3.3 Implement `resolveAuthJsonPath`, `readCredential`, `resolveStoredBaseUrl` in `src/auth-credentials.ts` (sync `readFileSync`, never throws, warns on non-ENOENT read errors)
- [x] 3.4 Run `npm test` to confirm all 17 pass
- [x] 3.5 Run `npm run typecheck` to confirm clean
- [x] 3.6 Commit

## 4. `omnirouteApiKeyAuth.login` (TDD)

- [x] 4.1 Write 6 tests in `test/auth.test.ts` for `login`: success path, prompt order, retry on invalid, retry exhausted, empty → default, cancel propagation
- [x] 4.2 Run `npm test` to confirm failure
- [x] 4.3 Add `omnirouteApiKeyAuth` with `name` + `login` (uses `promptBaseUrlWithRetry` with `MAX_URL_RETRIES = 1`) to `src/auth.ts`
- [x] 4.4 Run `npm test` to confirm all 23 pass
- [x] 4.5 Run `npm run typecheck` to confirm clean
- [x] 4.6 Commit

## 5. `omnirouteApiKeyAuth.resolve` (TDD)

- [x] 5.1 Add 7 tests in `test/auth.test.ts` for `resolve`: stored + baseUrl, stored key only, ambient + baseUrl, ambient key only, no-credential → undefined, stored wins over ambient, source never leaks key
- [x] 5.2 Run `npm test` to confirm failure
- [x] 5.3 Add `resolve` callback to `omnirouteApiKeyAuth` enforcing stored > ambient env > undefined priority
- [x] 5.4 Run `npm test` to confirm all 30 pass
- [x] 5.5 Run `npm run typecheck` to confirm clean
- [x] 5.6 Commit

## 6. `omnirouteApiKeyAuth.check` (TDD)

- [x] 6.1 Add 3 tests in `test/auth.test.ts` for `check`: stored has key → api_key check, ambient env → api_key check, neither → undefined
- [x] 6.2 Run `npm test` to confirm failure
- [x] 6.3 Add `check` callback to `omnirouteApiKeyAuth`
- [x] 6.4 Run `npm test` to confirm all 33 pass
- [x] 6.5 Run `npm run typecheck` to confirm clean
- [x] 6.6 Commit

## 7. Wire literal provider object into `src/index.ts`

- [x] 7.1 Verify `openAICompletionsApi` export path; switch to subpath import if not in top-level
- [x] 7.2 Replace `src/index.ts` with literal provider object passed to `pi.registerProvider(provider)`; resolve baseUrl from stored > env > default
- [x] 7.3 Update `tryRegisterModels` to mutate the closure-captured `models` array (no re-registration)
- [x] 7.4 Run `npm run typecheck` to confirm clean
- [x] 7.5 Run `npm test` to confirm 33 still pass
- [x] 7.6 Manual smoke: `node --experimental-strip-types --eval "import('./src/index.ts').then(m => console.log(typeof m.default))"` prints `function`
- [x] 7.7 Commit

## 8. Final verification

- [x] 8.1 `npm test` and `npm run typecheck` both succeed
- [x] 8.2 `git log --oneline` shows 7 clean commits
- [x] 8.3 No `pi.registerProvider("omniroute", {` legacy form remains in `src/`
- [x] 8.4 No `OMNIROUTE_DASHBOARD_PASSWORD` / `OMNIROUTE_AUTH_TOKEN` / `OMNIROUTE_REQUIRE_LOGIN` references in `src/`
- [x] 8.5 Update `openspec/changes/support-custom-baseurl-on-login/tasks.md` (Task 9) to mirror this plan
