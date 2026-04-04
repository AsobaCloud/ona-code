# Acceptance Matrix — ona-code (CLEAN_ROOM_SPEC)

| Row ID | Spec Obligation | PASS Criterion | Script/Command |
|--------|----------------|----------------|----------------|
| ROW-01 | §4.3 DDL tables | All 13 required tables exist in AGENT_SDLC_DB | `sdlc-acceptance.sh` ROW-01 |
| ROW-02 | §3, Appendix A hook order | `verify-sdlc-hook-order.mjs` exits 0, 27 members match | `sdlc-acceptance.sh` ROW-02 |
| ROW-03 | §4.2 schema version | `schema_meta` has `schema_version = '1'` | `sdlc-acceptance.sh` ROW-03 |
| ROW-04 | §7 tool definitions | All 21 built-in tools have definitions in `anthropicToolDefinitions()` | `sdlc-acceptance.sh` ROW-04 |
| ROW-05 | §0.3, §7.2 no stubs | No tool returns "not implemented" or "Unknown tool" for valid dispatch | `sdlc-acceptance.sh` ROW-05 |
| ROW-06 | §2.2 wire models | All provider/model_id pairs resolve to correct wire strings | `sdlc-acceptance.sh` ROW-06 |
| ROW-07 | §8.2 phase transitions | implement→verify blocked; implement→test allowed; test→verify allowed | `sdlc-acceptance.sh` ROW-07 |
| ROW-08 | §5.12 permissions | deny>ask>allow>defaultMode; all 5 modes correct | `sdlc-acceptance.sh` ROW-08 |
| ROW-09 | §8.3 planning gate | Write/Edit/Bash/NotebookEdit denied in planning; Read allowed | `sdlc-acceptance.sh` ROW-09 |
| ROW-10 | §2.8 no secrets in DB | No `sk-ant-*` or `Bearer` patterns in any DB table dump | `sdlc-acceptance.sh` ROW-10 |
| ROW-11 | §4.8 pragmas | foreign_keys=ON, journal_mode=WAL, busy_timeout=30000 | `sdlc-acceptance.sh` ROW-11 |
| ROW-12 | §2.7 A1 API key env | ANTHROPIC_API_KEY used when set | Manual: set env, run /status |
| ROW-13 | §2.7 A2 bearer env | ANTHROPIC_AUTH_TOKEN used when set | Manual: set env, run /status |
| ROW-14 | §2.7 A3 OAuth | /login option 3 opens browser OAuth | Manual: run /login, select 3 |
| ROW-15 | §2.7 A4 logout | /logout clears ~/.ona/secure/ | Manual: run /logout, verify file deleted |
| ROW-16 | §2.7 A5 status | /status shows kind without secrets | Manual: run /status |
| ROW-17 | §2.7 A7 bare mode | --bare disables bearer paths | Manual: run with --bare |
| ROW-18 | §2.7 O1 openai env | OPENAI_BASE_URL + OPENAI_API_KEY accepted | Manual: set env, configure provider |
| ROW-19 | §2.7 L1 lm_studio env | LM_STUDIO_* env vars accepted | Manual: set env, configure provider |
| ROW-20 | §2.9 /help | /help lists all commands | Manual: run /help |
| ROW-21 | §2.9 /model | /model changes model without restart | Manual: run /model |
| ROW-22 | §2.9 /clear | /clear resets conversation, emits hooks | Manual: run /clear |
| ROW-23 | §2.9 /config | /config shows settings | Manual: run /config |
| ROW-24 | §2.10 providers live | Each provider completes a turn with valid env | Manual: per provider |
| ROW-25 | §5.8 async rejected | async:true in hook stdout logged as invalid | Via hook test |
| ROW-26 | §8.5 epistemic isolation | Test generator input closed to plan only | Architecture review |
| ROW-27 | §8.5.3 anti-mock | Tests exercise public interfaces | Architecture review |
| ROW-28 | §8.6 coverage gate | test→verify blocked without coverage | `sdlc-acceptance.sh` ROW-07 |
