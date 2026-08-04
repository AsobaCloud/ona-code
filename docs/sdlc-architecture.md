# **Deterministic SDLC Architecture & Implementation Guide**

**Version 1.0**

This specification defines the operational requirements for **ona-code**, a state-governed autonomous agentic REPL. The architecture moves the system from a "chatbot" model to a "governed engine" model by enforcing strict lifecycle gates through the orchestrator.

## **1\. Core Architectural Invariants**

The following mechanical invariants are mandatory to prevent conversational drift and ensure protocol adherence.

### **1.1 Heartbeat State Synchronization**

The orchestrator must treat the system prompt as a dynamic variable. At the start of every iteration within the turn loop (the for(;;) block), the system must:

* Query the current phase from the database.  
* Re-synthesize the PHASE\_DIRECTIVES based on the real-time state.  
* Update the prompt context before the next API call.

### **1.2 Late Injection Pattern**

To defeat model recency bias and RLHF-based conversational filters, strict phase-specific rules and "Anti-Chat" warnings must be appended to the final user message in the context window. This ensures the mechanical obligations are the last tokens processed by the model's attention mechanism.

### **1.3 Universal Markdown Safety Net**

The orchestrator must universally scan all assistant text output for tool blocks wrapped in markdown JSON backticks. This parser must be decoupled from "manual tool" configurations to act as a fail-safe for any model that ignores native API protocols.

## **2\. The SDLC State Machine**

The SDLC is comprised of four distinct phases. Transition is unidirectional and requires the execution of a **Terminal Tool**.

### **2.1 IDLE Phase (Triage)**

* **Goal**: Intent classification and informational discovery.  
* **Capability Mask**: Only "Context Tools" (Read, LS, Glob) are enabled. Modification tools are mechanically blocked.  
* **Terminal Tool**: EnterPlanMode  
* **Enforcement**: If the model attempts an engineering task (e.g., proposed code changes) without calling the tool, the orchestrator rejects the response and forces a transition to PLANNING.

### **2.2 PLANNING Phase (Strategy)**

* **Goal**: Technical design and success criteria formulation.  
* **Constraint**: Forbidden from performing code modifications.  
* **Terminal Tool**: ExitPlanMode(content)  
* **The Approval Gate**: Execution of ExitPlanMode is atomically bound to a Human-in-the-Loop (HITL) prompt.  
  * **Approve (Y)**: Commit plan and transition to IMPLEMENT.  
  * **Reject (N)**: Return feedback to the model; state remains in PLANNING.

### **2.3 IMPLEMENT Phase (Execution)**

* **Goal**: Physical implementation of the approved plan.  
* **Capability Mask**: All modification tools (Write, Edit, Bash) are active.  
* **Terminal Tool**: SubmitImplementation  
* **Transition**: Automatic shift to TEST upon tool success.

### **2.4 TEST Phase (Validation)**

* **Goal**: Verification against "Given/When/Then" criteria.  
* **Constraint**: Model must provide evidence of passing tests (e.g., shell output).  
* **Terminal Tool**: SubmitTest  
* **Exit**: Returns to IDLE only upon successful validation.

## **3\. Enforcement Mechanisms**

### **3.1 The Instruction Interceptor (Gatekeeper)**

The orchestrator evaluates response blocks against the current phase's requirements.

* **Violation Detection**: If the state is PLANNING or TEST and the model provides text-only output without the required Terminal Tool, the orchestrator intercepts the response.  
* **Automated Recovery**: The response is hidden from the user, a **Protocol Violation** message is appended to the context, and the model is re-triggered until compliance is achieved.

### **3.2 Dynamic Directive Matrix**

| Phase | Mechanical Directive | Terminal Tool |
| :---- | :---- | :---- |
| **IDLE** | "You MUST call EnterPlanMode to start a task." | EnterPlanMode |
| **PLANNING** | "You MUST call ExitPlanMode to submit your plan." | ExitPlanMode |
| **IMPLEMENT** | "Call SubmitImplementation to trigger tests." | SubmitImplementation |
| **TEST** | "Call SubmitTest once criteria are met." | SubmitTest |

### **3.3 Universal Regex Extraction**

The system utilizes a deterministic regex to extract tool intent from any model response:

/ \+ String.fromCharCode(96, 96, 96\) \+ (?:json)?\\s\*(\\{\[\\s\\S\]\*?\\})\\s\* \+ String.fromCharCode(96, 96, 96\) \+ /g

## **4\. Operational Invariants**

1. **Stealth Modification Prevention**: Modification tools are physically removed from the JSON schema provided to the model when in IDLE or PLANNING.  
2. **Atomic Approval**: No plan can be "accepted" through chat; it must be submitted via the ExitPlanMode tool to trigger the UI approval prompt.  
3. **Evidence-Based Validation**: The SubmitTest tool requires a check for recent Bash command output to prevent "hallucinated passing" results.