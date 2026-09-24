- [x] Consenti di rinominare sessioni su darkfactory, usando come valore di default una descrizione brevissima e precomputata
- [x] verifica se la folder 'plugins' debba essere aggiunta a gitignore
- [ ] Raggruppa le sotto-sessioni (subagent) sotto la sessione padre nella wall di darkfactory. I transcript vivono in `~/.claude/projects/<progetto>/<parentSessionId>/subagents/agent-<id>.jsonl` (la directory contenitrice è l'id del padre; ogni riga ha `isSidechain: true`). Oggi non arrivano nemmeno alla wall: `scanClaudeTranscripts` (claude-harness.ts) fa una readdir non ricorsiva e ignora la sottocartella, quindi è un'aggiunta e non un allentamento del filtro `!p.interactive`. Da decidere: presentazione (riga espandibile sotto la card padre vs solo nella pinned card), se indicizzarli per la ricerca (no in prima battuta: raddoppia l'indice e riempie i risultati di frammenti senza contesto), e come dire che non sono riprendibili (`claude --resume` non li accetta, al massimo follow read-only). Solo Claude: opencode non ha file di transcript.
- [x] Aggiungi un browser per ogni pinned terminal, apribile da pulsante specifico, cosi' da poter controllare in tempo reale cosa fa la sessione (e.g. PR, o web preview)
- [x] Quando lanci un agente esperto in un workspace, chiedi su quale folder vuoi attivarlo
- [x] Tra i plugin ne vedo molti che non sembrano utilizzati (e.g. i temi)
- [x] Strano warning apparso a run-time nel log "2026-09-10T16:18:48.672Z root INFO WARN: Could not find the language 'bash', did you forget to load/include a language module?"
- [x] icona timeout non ha tooltip, descrizioni, e' poco intelligibile
- [x] from time to time it crashes with: 2026-09-13T03:19:28.855Z root ERROR [darkfactory] backend event loop blocked ~24253ms
2026-09-13T03:20:01.092Z root ERROR [darkfactory] backend event loop blocked ~24241ms
2026-09-13T03:20:33.433Z root ERROR [darkfactory] backend event loop blocked ~24342ms
2026-09-13T03:21:05.710Z root ERROR [darkfactory] backend event loop blocked ~24275ms
2026-09-13T03:38:34.397Z root ERROR [darkfactory] backend event loop blocked ~1040682ms
2026-09-13T03:39:04.575Z root ERROR [darkfactory] backend event loop blocked ~24181ms
2026-09-13T03:39:36.831Z root ERROR [darkfactory] backend event loop blocked ~24259ms
2026-09-13T03:40:13.076Z root ERROR [darkfactory] backend event loop blocked ~24242ms
2026-09-13T03:40:45.321Z root ERROR [darkfactory] backend event loop blocked ~24245ms
2026-09-13T03:41:17.555Z root ERROR [darkfactory] backend event loop blocked ~24232ms
2026-09-13T03:57:57.373Z root ERROR [darkfactory] backend event loop blocked ~991817ms
2026-09-13T03:58:27.546Z root ERROR [darkfactory] backend event loop blocked ~24175ms
2026-09-13T03:58:59.775Z root ERROR [darkfactory] backend event loop blocked ~24236ms
2026-09-13T03:59:31.998Z root ERROR [darkfactory] backend event loop blocked ~24228ms
2026-09-13T04:00:04.268Z root ERROR [darkfactory] backend event loop blocked ~24272ms
2026-09-13T04:00:36.519Z root ERROR [darkfactory] backend event loop blocked ~24254ms
2026-09-13T04:01:08.785Z root ERROR [darkfactory] backend event loop blocked ~24264ms
2026-09-13T04:17:13.329Z root ERROR [darkfactory] backend event loop blocked ~956541ms
2026-09-13T04:17:43.486Z root ERROR [darkfactory] backend event loop blocked ~24150ms
2026-09-13T04:18:15.777Z root ERROR [darkfactory] backend event loop blocked ~24278ms
2026-09-13T04:22:05.339Z root ERROR [darkfactory] backend event loop blocked ~221553ms
2026-09-13T04:22:51.731Z root ERROR [darkfactory] backend event loop blocked ~36383ms
2026-09-13T04:38:53.349Z root ERROR [darkfactory] backend event loop blocked ~953614ms
2026-09-13T04:55:34.360Z root ERROR [darkfactory] backend event loop blocked ~995004ms
2026-09-13T05:12:45.371Z root ERROR [darkfactory] backend event loop blocked ~1025000ms
2026-09-13T05:23:05.389Z root ERROR [darkfactory] backend event loop blocked ~614009ms
2026-09-13T05:39:14.396Z root ERROR [darkfactory] backend event loop blocked ~960987ms
2026-09-13T05:56:48.409Z root ERROR [darkfactory] backend event loop blocked ~1048006ms
2026-09-13T06:11:59.411Z root ERROR [darkfactory] backend event loop blocked ~905003ms
2026-09-13T06:12:29.562Z root ERROR [darkfactory] backend event loop blocked ~24156ms
2026-09-13T06:13:01.833Z root ERROR [darkfactory] backend event loop blocked ~24273ms
2026-09-13T06:13:34.087Z root ERROR [darkfactory] backend event loop blocked ~24256ms
2026-09-13T06:14:06.359Z root ERROR [darkfactory] backend event loop blocked ~24274ms
2026-09-13T06:14:38.615Z root ERROR [darkfactory] backend event loop blocked ~24258ms
2026-09-13T06:15:12.410Z root ERROR [darkfactory] backend event loop blocked ~24780ms
2026-09-13T06:24:05.390Z root ERROR [darkfactory] backend event loop blocked ~524979ms
2026-09-13T06:40:46.392Z root ERROR [darkfactory] backend event loop blocked ~993002ms
2026-09-13T06:41:16.508Z root ERROR [darkfactory] backend event loop blocked ~24180ms
2026-09-13T06:41:48.814Z root ERROR [darkfactory] backend event loop blocked ~24288ms
2026-09-13T06:42:22.755Z root ERROR [darkfactory] backend event loop blocked ~24929ms
2026-09-13T06:42:54.997Z root ERROR [darkfactory] backend event loop blocked ~24238ms
2026-09-13T06:43:27.295Z root ERROR [darkfactory] backend event loop blocked ~24295ms
2026-09-13T06:43:59.555Z root ERROR [darkfactory] backend event loop blocked ~24258ms
2026-09-13T06:48:23.358Z root ERROR [darkfactory] backend event loop blocked ~255801ms
2026-09-13T07:01:47.046Z root ERROR [darkfactory] backend event loop blocked ~792682ms
- [x] Spexr si era freezato dopo aver collegato un monitor esterno, non so se puo' centrare, comunque nel log c'era: 2026-09-15T07:05:44.746Z core:DefaultMessagingService INFO Closing channel on service path '/services/terminals/1444163418'.
2026-09-15T07:05:44.746Z core:DefaultMessagingService INFO Closing channel on service path '/services/terminals/952047588'.
2026-09-15T07:05:45.918Z core:WebsocketFrontendConnectionService INFO Reconnecting failed for 1
2026-09-15T07:05:45.944Z core:WebsocketFrontendConnectionService INFO creating connection for 1
2026-09-15T07:05:46.052Z root INFO reconnect failed on _Q73r4RiaWChasRoAAAg
2026-09-15T07:05:46.052Z root INFO sending initial connect on undefined
2026-09-15T07:05:46.052Z root INFO reconnect failed on undefined
2026-09-15T07:05:46.052Z root INFO sending initial connect on undefined
2026-09-15T07:05:46.052Z root INFO sending reconnect on eHzO2S-h3SdztNChAAAj
2026-09-15T07:05:46.053Z root INFO initial connect received on eHzO2S-h3SdztNChAAAj
2026-09-15T07:05:46.053Z root INFO initial connect received on eHzO2S-h3SdztNChAAAj
2026-09-15T07:05:54.539Z root ERROR [darkfactory] backend event loop blocked ~2511ms
2026-09-15T07:06:01.896Z root ERROR [darkfactory] backend event loop blocked ~1322ms
2026-09-15T07:06:38.383Z root ERROR Error: Widget is already attached.
    at _Widget.attach (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:208012:19)
    at TerminalWidgetImpl.onAfterAttach (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:584886:28)
    at TerminalWidgetImpl.processMessage (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:207740:20)
    at TerminalWidgetImpl.processMessage (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:584863:17)
    at invokeHandler (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:203511:21)
    at Object.sendMessage (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:203393:13)
    at Object.attach (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:221221:35)
    at file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:608771:42
    at Object.react_stack_bottom_frame (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:242433:23)
    at runWithFiberInDEV (file:///Users/marcello.barile/src/mine/ai-tools/spexr/apps/desktop/lib/frontend/bundle.js:224863:74)
- [x] In certain unclear cases the pinned terminals starts increasing their height autonomously (one time it happened after having resized a near one)
- [x] Sporadically, pinned sessions on darkfactory lost the pinned status (closing the pinned tile)
- [ ] How to treat hung or zombie claude sessions / processes
- [x] From time to time, the pinned terminal glitches (e.g. characters overlap, or the whole output goes full black except for few characters) there is no way to restore, not even closing and reopening the card
- [ ] Integrate MxM into SPEXR (optional)
- [ ] Add a TODO view in SPEXR (based on a TODO.md file)
