/**
 * VOICE INTEGRATION GUIDE
 *
 * This document outlines how voice commands flow through the Atlas application.
 *
 * ARCHITECTURE
 * ============
 *
 * VoiceSessionProvider (src/components/voice-session.tsx)
 *   ↓
 *   Singleton provider hoisted above BrowserRouter
 *   Manages: wake word, ambient listening, TTS, conversation turns
 *   Persists: across all route changes
 *   ↓
 * AtlasContextProvider (src/lib/atlas-experience/context.tsx)
 *   ↓
 *   Provides: current entity (claim, workflow, etc.), route, page context
 *   ↓
 * AppShell + AtlasInputBar (src/components/app-shell.tsx)
 *   ↓
 *   Injects: useVoicePageContext() into voice components
 *   ↓
 * VoiceIntentRouter (src/lib/voice-intents.ts)
 *   ↓
 *   Maps: "show claims" → /dashboard/revenue-recovery
 *   Maps: "open this" → current entity detail page
 *   ↓
 * VoiceActionExecutor (src/lib/voice-actions.ts)
 *   ↓
 *   Routes: voice intents to existing mutations/actions
 *   Enforces: same authorization as UI buttons
 *   Uses: existing realtime state architecture
 *
 * COMMAND FLOW
 * ============
 *
 * USER SAYS: "Atlas, show claims"
 *
 * 1. Wake Word Engine detects "Atlas" (local, browser-side)
 * 2. Command "show claims" captured (local, browser-side)
 * 3. sendCommand() called with "show claims"
 * 4. converse() API called with:
 *    - transcript: "show claims"
 *    - pageContext: { route, entityType, entityId, ... }
 * 5. Backend returns:
 *    - intent: "navigate_claims"
 *    - answer: "Opening your claims list"
 *    - spoken: "Opening your claims list"
 * 6. Check: intent matches navigation pattern
 * 7. Route: handleVoiceIntent() → navigate("/dashboard/revenue-recovery")
 * 8. Speak: "Opening your claims list" via TTS
 * 9. Resume: ambient listening
 *
 * NAVIGATION INTENTS
 * ==================
 *
 * Pattern: /claims|revenue\s+recovery|supplements?/i
 *   Command: "show claims"
 *   Action: navigate("/dashboard/revenue-recovery")
 *
 * Pattern: /workflows?|work|tasks?/i
 *   Command: "show workflows"
 *   Action: navigate("/dashboard/workflows")
 *
 * Pattern: /knowledge|documents?|evidence/i
 *   Command: "show knowledge base"
 *   Action: navigate("/dashboard/knowledge")
 *
 * Pattern: /intelligence|insights?|signals?|recommendations?/i
 *   Command: "show recommendations"
 *   Action: navigate("/dashboard/intelligence")
 *
 * ENTITY CONTEXT INTENTS
 * ======================
 *
 * When viewing /dashboard/revenue-recovery/:claimId:
 *
 *   Command: "open this claim"
 *   Entity Context: { type: "claim", id: "claim-123" }
 *   Action: navigate("/dashboard/revenue-recovery/claim-123") (already there)
 *
 * Command: "what is blocking this claim?"
 *   Entity Context: { type: "claim", id: "claim-123" }
 *   Backend: scopes answer to current claim
 *   Action: conversational query
 *
 * BUSINESS ACTION INTENTS
 * =======================
 *
 * These route through the action executor (src/lib/voice-actions.ts).
 * DO NOT create separate voice-only implementations — reuse existing mutations.
 *
 * Example: "Create a supplement"
 *
 *   1. Intent detected: "create_supplement"
 *   2. Check entity context: { type: "claim", id: "claim-123" }
 *   3. Call executeCreateSupplementVoice(claimId, reason, createSupplement)
 *   4. createSupplement uses existing api.supplements.create mutation
 *   5. Authorization checked (same as UI button)
 *   6. Realtime state updated (same as UI)
 *   7. Response spoken: "Supplement created"
 *
 * IMPLEMENTING NEW VOICE ACTIONS
 * ==============================
 *
 * 1. Add a handler in src/lib/voice-actions.ts:
 *
 *    export async function executeMyActionVoice(...) {
 *      // Use existing mutation/action, don't create parallel logic
 *      const result = await myExistingMutation({ ... });
 *      return { success: true, message: "Done", shouldSpeak: false };
 *    }
 *
 * 2. Map intent to handler in intentToActionDispatch():
 *
 *    if (intent.includes("my_action")) {
 *      return { type: "my_action", parameters: {} };
 *    }
 *
 * 3. In AtlasAssistant (or where voice is consumed):
 *
 *    const dispatch = intentToActionDispatch(res.intent, res.pending);
 *    if (dispatch) {
 *      const result = await executeVoiceAction(dispatch, context);
 *      if (result.success) {
 *        // Optionally speak result if dispatch.shouldSpeak = true
 *      }
 *    }
 *
 * PAGE CONTEXT PROPAGATION
 * ========================
 *
 * Every page automatically provides context via useVoicePageContext():
 *
 *   const pageContext = useVoicePageContext();
 *   // → {
 *   //   route: "/dashboard/revenue-recovery/claim-123",
 *   //   entityType: "claim",
 *   //   entityId: "claim-123",
 *   //   entityName: "Claim #12345",
 *   //   isEntityFocused: true
 *   // }
 *
 * This is serialized and passed to the converse() API, so the backend
 * understands what the user is currently looking at.
 *
 * PREVENTING DUPLICATE IMPLEMENTATIONS
 * =====================================
 *
 * ❌ DO NOT:
 *
 *   export async function handleCreateSupplementVoice() {
 *     // Custom voice-only logic
 *     const result = await rpcCall(supabase, "custom_voice_supplement", { ... });
 *   }
 *
 * ✅ DO:
 *
 *   export async function executeCreateSupplementVoice(
 *     claimId,
 *     reason,
 *     createSupplement  // ← pass in the existing mutation
 *   ) {
 *     const result = await createSupplement({ claimId, reason });
 *     return { success: true, message: "Created", shouldSpeak: false };
 *   }
 *
 * TESTING VOICE INTEGRATION
 * ==========================
 *
 * See: VOICE_INTEGRATION_TESTS.md for comprehensive test suite
 *
 * Key scenarios:
 * 1. Navigation intent routing
 * 2. Entity context awareness
 * 3. Voice persists across navigation
 * 4. Wake word works repeatedly
 * 5. TTS doesn't trigger false wake events
 * 6. Typed + voice share history
 * 7. Authorization enforced for voice actions
 * 8. Realtime updates appear after voice actions
 *
 * FILES CHANGED
 * =============
 *
 * src/lib/voice-intents.ts (new)
 *   - handleVoiceIntent() — maps commands to navigation
 *   - buildEntityPath() — constructs detail page URLs
 *
 * src/lib/voice-actions.ts (new)
 *   - executeCreateSupplementVoice() — supplement creation
 *   - executeDecideRecommendationVoice() — recommendation decisions
 *   - executeUpdateSupplementStatusVoice() — status updates
 *   - executeWorkflowActionVoice() — workflow actions
 *   - intentToActionDispatch() — intent → action mapper
 *
 * src/components/voice-context-provider.tsx (new)
 *   - useVoicePageContext() — infer context from route + entity
 *   - serializeVoicePageContext() — encode for API
 *   - VoiceContextAware wrapper (future enhancement)
 *
 * src/components/app-shell.tsx (updated)
 *   - AtlasInputBar now calls useVoicePageContext()
 *   - pageContext passed to useVoice() hook
 *   - Voice indicator updated with contextual placeholder text
 *
 * src/components/voice-session.tsx
 *   - No changes (already hoisted above BrowserRouter in src/main.tsx)
 *
 * KNOWN LIMITATIONS
 * =================
 *
 * 1. PTT (push-to-talk) requires manual button press
 *    (Ambient wake word "Atlas" is not always 100% reliable)
 *
 * 2. TTS quality varies by browser
 *    (Chrome has best support, Safari/Firefox OK)
 *
 * 3. Microphone access must be granted explicitly
 *    (Browser permission request shown once per site)
 *
 * 4. Voice commands timeout after 15 seconds
 *    (Prevents hung requests if network is slow)
 *
 * 5. Complex commands should use typed input
 *    (Voice is optimized for single-intent utterances)
 *
 * FUTURE ENHANCEMENTS
 * ====================
 *
 * 1. Intent confidence scoring
 *    (Fallback to clarification dialog if confidence < 0.8)
 *
 * 2. Voice command history
 *    (Display recent voice commands in sidebar)
 *
 * 3. Custom voice shortcuts
 *    (Allow users to define "show X" for custom pages)
 *
 * 4. Batch voice actions
 *    (Queue multiple voice commands and execute sequentially)
 *
 * 5. Voice action confirmation
 *    (Require voice confirmation before executing mutations)
 *
 * DEBUGGING
 * =========
 *
 * To inspect voice state:
 *   const session = useVoiceSession();
 *   console.log(session.status);        // current state
 *   console.log(session.interim);       // partial transcript
 *   console.log(session.turns);         // conversation history
 *   console.log(session.ambientEnabled); // ambient listening active?
 *
 * To test intent routing:
 *   import { handleVoiceIntent } from "@/lib/voice-intents";
 *   const result = await handleVoiceIntent("show claims", "navigate_claims", context);
 *   console.log(result.redirectPath); // Should be "/dashboard/revenue-recovery"
 *
 * To test action executor:
 *   import { intentToActionDispatch } from "@/lib/voice-actions";
 *   const dispatch = intentToActionDispatch("create_supplement", { kind: "confirm_action" });
 *   console.log(dispatch); // Should map to action type
 */

export {};
