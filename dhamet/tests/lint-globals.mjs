// Names the linter accepts as defined without a declaration in the file that uses them.
// Three groups: what the browser provides, what the Cloudflare Worker provides, and the
// names the Dhamet scripts share with one another (they are classic scripts loaded one
// after the other, so a name declared at the top level of one file is used by the next).

const names = (text) => Object.fromEntries(text.trim().split(/\s+/).map((name) => [name, 'readonly']));

export const browserGlobals = names(`
  window document location history navigator screen performance console localStorage sessionStorage
  setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame queueMicrotask
  fetch Request Response Headers URL URLSearchParams AbortController Event CustomEvent TextEncoder TextDecoder
  atob btoa crypto Blob FileReader FormData WebSocket Worker BroadcastChannel MutationObserver
  getComputedStyle matchMedia alert confirm prompt RTCPeerConnection RTCSessionDescription RTCIceCandidate
  MediaStream Audio Image HTMLElement Element Node NodeList IntersectionObserver ResizeObserver
  structuredClone globalThis module DedicatedWorkerGlobalScope
`);

export const workerGlobals = names(`
  console fetch Request Response Headers URL URLSearchParams AbortController Event TextEncoder TextDecoder
  atob btoa crypto Blob WebSocket WebSocketPair WebSocketRequestResponsePair setTimeout clearTimeout
  setInterval clearInterval queueMicrotask structuredClone globalThis
`);

export const webWorkerGlobals = names(`
  self importScripts postMessage console setTimeout clearTimeout performance globalThis module
  DedicatedWorkerGlobalScope
`);

export const nodeGlobals = names(`
  process console Buffer setTimeout clearTimeout setInterval clearInterval setImmediate queueMicrotask
  URL URLSearchParams TextEncoder TextDecoder AbortController fetch Request Response Headers structuredClone globalThis
  require module exports __dirname __filename
`);

// Shared between the Dhamet scripts of the site (declared at the top level of one file,
// used from others). A new name that is not declared in its own file or listed here is
// reported, which is what catches a misspelled or missing name before it reaches players.
export const appGlobals = names(`
  AI Game Input Modal Online Turn UI Visual ZAuth ZShell
  BOARD_N BOT TOP FO_BOT FO_TOP DIAG_A_SEGMENTS DIAG_B_SEGMENTS
  DhametAIConfig DhametControl DhametMatchCoordinator DhametMatchMode DhametPvCController
  DhametPvCSession DhametRulesShared DhametSouflaView PvCResultRecorder SessionGame
  aiSide applyMove applySouflaDecision applyTheme applyLanguage classifyCapture
  completeForcedOpeningPly encodeAction endsOnSouflaWaiver fromViewRC generateCapturesFrom
  getAILevelConfig getForcedOpeningExpectedAction getForcedOpeningInfo getForcedOpeningInfos
  humanSide idxToRC initI18n isForcedOpeningActive legalActions loadSessionSettings
  maybeQueueDeferredPromotion normalizeAILevel pieceKind pieceOwner qs qsa rcStr rcToIdx
  rememberForcedOpeningExchange resetTransientGameState restoreSnapshot saveSessionSettings
  scheduleForcedOpeningAutoIfNeeded shouldShowKillTimerAlert showUiNotice sideLabel
  setupInitialBoard snapshotState syncEndKillAvailability t toViewRC valueAt
`);

// Names the browser tests use inside page.evaluate (they run in the game page, not in Node):
// browser classes the base list leaves out, and the page's own globals.
export const pageTestGlobals = names(`
  Storage MouseEvent ErrorEvent PromiseRejectionEvent I18N CloudflareAuth DhametGameRoomClient DhametRules
  DhametTurnResolutionShared applyForcedOpeningInfo finishForcedOpeningAppliedTurn boardIdxFromClient
  checkEndConditions Game
`);
