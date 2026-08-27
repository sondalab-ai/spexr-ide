// Moved to common/harness so both the node backend and the browser frontend
// import one copy. Re-exported here to keep existing import paths valid.
export { isSessionId, buildResumeArgs } from "../../common/harness/resume-args.js";
